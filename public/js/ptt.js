/**
 * Push-to-Talk functionality for receiver
 * Audio ducking and pre-acquired microphone
 *
 * Pre-acquires the phone's built-in microphone at page load (when permission
 * is already granted) and keeps it alive with track.enabled = false.
 * This avoids calling getUserMedia during PTT, which would trigger a
 * Bluetooth A2DP → HFP profile switch and kill audio playback.
 *
 * The disabled mic track uses negligible resources and does not record audio.
 * When PTT is pressed, we just flip track.enabled = true — instant, no
 * profile switch, no audio disruption.
 */

import {
    isAudioRoutedThroughWebAudio,
    setPlaybackVolume,
    getPlaybackVolume
} from './audio-analysis.js';

// Audio ducking constant
const DUCKING_VOLUME = 0.15;

// State
let pttStream = null;      // Fallback stream (when pre-acquired mic unavailable)
let pttActive = false;
let preDuckVolume = null;
let builtInMicDeviceId = null; // Cached built-in mic device ID

// Pre-acquired mic state
let persistentMicTrack = null;   // Mic track kept alive for instant PTT
let persistentMicStream = null;  // Stream associated with persistent mic
let micAcquiring = false;        // Prevent concurrent acquisition attempts

// Audio recovery state (only used for fallback path)
let deviceChangeHandler = null;
let recoveryTimers = [];

// Dependencies
let remoteVideo = null;
let sendSignal = null;
let getIsConnected = null;
let getPTTAudioSender = null;

/**
 * Initialize PTT module
 * @param {object} deps
 */
export function initPTT(deps) {
    remoteVideo = deps.remoteVideo;
    sendSignal = deps.sendSignal;
    getIsConnected = deps.getIsConnected;
    getPTTAudioSender = deps.getPTTAudioSender;
}

// Track if we sent ptt-start (to ensure we always send ptt-stop)
let pttStartSent = false;

/**
 * Find the built-in microphone device ID by filtering out Bluetooth devices.
 * Returns null if no non-Bluetooth mic is found (will fall back to default).
 */
async function findBuiltInMic() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        console.log('PTT: Available audio inputs:', audioInputs.map(d => `${d.label} (${d.deviceId.substring(0, 8)}...)`));

        if (audioInputs.length <= 1) {
            return null;
        }

        // Filter out Bluetooth devices by label keywords
        const btKeywords = ['bluetooth', 'bt ', 'wireless', 'airpod', 'galaxy buds',
            'jabra', 'bose', 'sony wh', 'sony wf', 'beats', 'jbl',
            'sennheiser', 'pixel buds', 'nothing ear'];
        const nonBtDevices = audioInputs.filter(d => {
            const label = d.label.toLowerCase();
            return !btKeywords.some(kw => label.includes(kw));
        });

        if (nonBtDevices.length > 0) {
            const chosen = nonBtDevices[0];
            console.log('PTT: Selected built-in mic:', chosen.label || chosen.deviceId);
            return chosen.deviceId;
        }

        console.log('PTT: Could not identify built-in mic, will use default');
        return null;
    } catch (err) {
        console.log('PTT: Could not enumerate devices:', err);
        return null;
    }
}

/**
 * Recover audio playback after audio device/routing changes.
 * Only used in the fallback path when getUserMedia is called during PTT.
 */
function recoverAudioPlayback() {
    if (!remoteVideo || !remoteVideo.srcObject) return;

    console.log('PTT: Recovering audio playback...');

    if (typeof remoteVideo.setSinkId === 'function') {
        remoteVideo.setSinkId('').then(() => {
            console.log('PTT: Reset audio sink to default');
        }).catch(e => {
            console.log('PTT: setSinkId failed:', e.message);
        });
    }

    const stream = remoteVideo.srcObject;
    remoteVideo.srcObject = null;
    remoteVideo.srcObject = stream;

    remoteVideo.play().catch(e => console.log('PTT: Audio recovery play failed:', e));
}

function startAudioRecoveryMonitoring() {
    stopAudioRecoveryMonitoring();

    deviceChangeHandler = () => {
        console.log('PTT: Audio device change detected, recovering...');
        recoverAudioPlayback();
    };
    navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
}

function stopAudioRecoveryMonitoring() {
    if (deviceChangeHandler) {
        navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
        deviceChangeHandler = null;
    }
    recoveryTimers.forEach(t => clearTimeout(t));
    recoveryTimers = [];
}

function scheduleRecoveryAttempts() {
    const delays = [200, 600, 1200];
    delays.forEach(delay => {
        recoveryTimers.push(setTimeout(recoverAudioPlayback, delay));
    });
}

/**
 * Get microphone constraints that prefer the built-in mic over Bluetooth.
 */
async function getMicConstraints() {
    if (builtInMicDeviceId === null) {
        builtInMicDeviceId = await findBuiltInMic() || '';
    }

    const constraints = {
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
    };

    if (builtInMicDeviceId) {
        constraints.audio.deviceId = { exact: builtInMicDeviceId };
    }

    return constraints;
}

/**
 * Pre-acquire microphone for instant PTT without Bluetooth profile switches.
 *
 * Call this early — ideally before audio starts playing through Bluetooth.
 * If mic permission is already granted, this acquires the built-in mic and
 * keeps it disabled (track.enabled = false). No audio is captured.
 *
 * When PTT is later pressed, we just enable the existing track — no
 * getUserMedia call, no Bluetooth A2DP → HFP switch, no audio disruption.
 *
 * @returns {Promise<boolean>} true if mic was successfully pre-acquired
 */
export async function acquirePTTMic() {
    // Already acquired and alive
    if (persistentMicTrack && persistentMicTrack.readyState === 'live') {
        return true;
    }

    // Prevent concurrent acquisitions
    if (micAcquiring) {
        return false;
    }
    micAcquiring = true;

    try {
        const constraints = await getMicConstraints();
        console.log('PTT: Pre-acquiring mic for instant PTT...',
            builtInMicDeviceId ? `(built-in: ${builtInMicDeviceId.substring(0, 8)}...)` : '(default)');

        persistentMicStream = await navigator.mediaDevices.getUserMedia(constraints);
        persistentMicTrack = persistentMicStream.getAudioTracks()[0];

        // Disable immediately — we don't want to capture audio yet
        persistentMicTrack.enabled = false;

        // Monitor for unexpected track end (device disconnected, etc.)
        persistentMicTrack.onended = () => {
            console.log('PTT: Pre-acquired mic track ended unexpectedly');
            persistentMicTrack = null;
            persistentMicStream = null;
        };

        console.log('PTT: Mic pre-acquired and disabled:', persistentMicTrack.label);
        return true;
    } catch (err) {
        // If exact device constraint fails, retry without device preference
        if (err.name === 'OverconstrainedError' && builtInMicDeviceId) {
            console.log('PTT: Built-in mic unavailable for pre-acquisition, trying default');
            builtInMicDeviceId = '';
            try {
                persistentMicStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                });
                persistentMicTrack = persistentMicStream.getAudioTracks()[0];
                persistentMicTrack.enabled = false;
                persistentMicTrack.onended = () => {
                    persistentMicTrack = null;
                    persistentMicStream = null;
                };
                console.log('PTT: Mic pre-acquired (fallback device):', persistentMicTrack.label);
                return true;
            } catch (fallbackErr) {
                console.log('PTT: Fallback mic pre-acquisition failed:', fallbackErr.message);
            }
        } else {
            console.log('PTT: Mic pre-acquisition failed:', err.message);
        }
        return false;
    } finally {
        micAcquiring = false;
    }
}

/**
 * Start push-to-talk
 * @param {HTMLElement} pttBtn
 * @param {HTMLElement} pttLabel
 */
export async function startPTT(pttBtn, pttLabel) {
    if (pttActive) {
        console.log('PTT: Already active');
        return;
    }
    if (!getIsConnected()) {
        console.log('PTT: Not connected, isConnected:', getIsConnected());
        return;
    }

    const pttSender = getPTTAudioSender?.();
    if (!pttSender) {
        console.log('PTT: No audio sender available (connection not ready)');
        return;
    }

    // All checks passed - activate PTT
    pttActive = true;
    pttBtn.classList.add('active');
    pttLabel.textContent = 'Speaking...';

    // Audio ducking - lower baby audio to prevent echo
    if (isAudioRoutedThroughWebAudio()) {
        preDuckVolume = getPlaybackVolume();
        setPlaybackVolume(Math.min(preDuckVolume, DUCKING_VOLUME));
        console.log('PTT: Ducked Web Audio volume from', preDuckVolume, 'to', Math.min(preDuckVolume, DUCKING_VOLUME));
    } else {
        preDuckVolume = remoteVideo.volume;
        remoteVideo.volume = Math.min(remoteVideo.volume, DUCKING_VOLUME);
        console.log('PTT: Ducked video element volume from', preDuckVolume, 'to', remoteVideo.volume);
    }

    // Notify sender that PTT is starting
    sendSignal({ type: 'ptt-start' });
    pttStartSent = true;
    console.log('PTT: Sent start notification');

    try {
        // PRIMARY PATH: Use pre-acquired mic (no getUserMedia = no BT profile switch)
        if (persistentMicTrack && persistentMicTrack.readyState === 'live') {
            persistentMicTrack.enabled = true;
            await pttSender.replaceTrack(persistentMicTrack);
            console.log('PTT: Instant start (pre-acquired mic, no BT disruption)');
            return;
        }

        // FALLBACK PATH: No pre-acquired mic — must call getUserMedia
        // This WILL trigger a Bluetooth profile switch on the first PTT press.
        // After this succeeds, we promote the stream to persistent mic so
        // subsequent PTT presses are instant.
        console.log('PTT: No pre-acquired mic, falling back to getUserMedia (may disrupt BT audio)');

        startAudioRecoveryMonitoring();

        const constraints = await getMicConstraints();
        pttStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('PTT: Got microphone via fallback');

        scheduleRecoveryAttempts();

        const audioTrack = pttStream.getAudioTracks()[0];
        await pttSender.replaceTrack(audioTrack);
        console.log('PTT: Replaced track - audio now flowing');

        // Promote to persistent mic for future PTT presses
        persistentMicStream = pttStream;
        persistentMicTrack = audioTrack;
        persistentMicTrack.onended = () => {
            console.log('PTT: Promoted mic track ended');
            persistentMicTrack = null;
            persistentMicStream = null;
        };
        pttStream = null; // Ownership transferred to persistent
        console.log('PTT: Promoted fallback mic to persistent (next PTT will be instant)');

    } catch (err) {
        // If exact device constraint fails, retry without device preference
        if (err.name === 'OverconstrainedError' && builtInMicDeviceId) {
            console.log('PTT: Built-in mic not available, falling back to default');
            builtInMicDeviceId = '';
            try {
                pttStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });
                const audioTrack = pttStream.getAudioTracks()[0];
                await pttSender.replaceTrack(audioTrack);
                console.log('PTT: Fallback mic active - audio now flowing');
                scheduleRecoveryAttempts();

                // Promote this too
                persistentMicStream = pttStream;
                persistentMicTrack = audioTrack;
                persistentMicTrack.onended = () => {
                    persistentMicTrack = null;
                    persistentMicStream = null;
                };
                pttStream = null;
                return;
            } catch (fallbackErr) {
                console.error('PTT fallback error:', fallbackErr);
            }
        }
        console.error('PTT error:', err);
        pttLabel.textContent = 'Mic access denied';
        stopPTT(pttBtn, pttLabel);
    }
}

/**
 * Stop push-to-talk
 * @param {HTMLElement} pttBtn
 * @param {HTMLElement} pttLabel
 */
export async function stopPTT(pttBtn, pttLabel) {
    // Always reset visual state
    pttBtn.classList.remove('active');
    pttLabel.textContent = 'Hold to talk to baby';

    // Always send ptt-stop if we sent ptt-start (even if pttActive is false due to race)
    if (pttStartSent) {
        sendSignal({ type: 'ptt-stop' });
        console.log('PTT: Sent stop notification');
        pttStartSent = false;
    }

    if (!pttActive) {
        console.log('PTT: stopPTT called but not active');
        return;
    }
    pttActive = false;

    console.log('PTT: Stopping...');

    // Restore audio volume (un-duck)
    if (preDuckVolume !== null) {
        if (isAudioRoutedThroughWebAudio()) {
            setPlaybackVolume(preDuckVolume);
            console.log('PTT: Restored Web Audio volume to', preDuckVolume);
        } else {
            remoteVideo.volume = preDuckVolume;
            console.log('PTT: Restored video element volume to', preDuckVolume);
        }
        preDuckVolume = null;
    }

    // Clear the track from the sender (no renegotiation needed)
    const pttSender = getPTTAudioSender?.();
    if (pttSender) {
        try {
            await pttSender.replaceTrack(null);
            console.log('PTT: Cleared track from sender');
        } catch (e) {
            console.log('PTT: Could not clear track:', e);
        }
    }

    // If using persistent mic: just disable the track (keep alive for next PTT!)
    // No getUserMedia needed next time = no Bluetooth profile switch
    if (persistentMicTrack && persistentMicTrack.readyState === 'live') {
        persistentMicTrack.enabled = false;
        console.log('PTT: Mic disabled (kept alive for next PTT)');
    }

    // If using fallback stream (shouldn't happen with promotion, but safety net)
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
        console.log('PTT: Fallback mic stopped');
        scheduleRecoveryAttempts();
        setTimeout(stopAudioRecoveryMonitoring, 3000);
    }

    console.log('PTT: Stopped');
}

/**
 * Setup PTT button event listeners
 * @param {HTMLElement} pttBtn
 * @param {HTMLElement} pttLabel
 */
export function setupPTTButton(pttBtn, pttLabel) {
    console.log('PTT: Button setup complete');

    // If mic permission is already granted, pre-acquire the mic immediately.
    // This happens BEFORE audio starts playing through Bluetooth, so any
    // profile switch happens when there's nothing to disrupt.
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(result => {
            console.log('PTT: Microphone permission state:', result.state);
            if (result.state === 'granted') {
                acquirePTTMic();
            }
            result.onchange = () => {
                console.log('PTT: Microphone permission changed to:', result.state);
                if (result.state === 'granted') {
                    acquirePTTMic();
                }
            };
        }).catch(e => console.log('PTT: Could not query mic permission:', e));
    }

    // Mouse events
    pttBtn.addEventListener('mousedown', (e) => {
        console.log('PTT: mousedown event');
        e.preventDefault();
        startPTT(pttBtn, pttLabel);
    });

    pttBtn.addEventListener('mouseup', () => stopPTT(pttBtn, pttLabel));
    pttBtn.addEventListener('mouseleave', () => stopPTT(pttBtn, pttLabel));

    // Touch events
    pttBtn.addEventListener('touchstart', (e) => {
        console.log('PTT: touchstart event');
        e.preventDefault();
        startPTT(pttBtn, pttLabel);
    });

    pttBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopPTT(pttBtn, pttLabel);
    });

    pttBtn.addEventListener('touchcancel', () => stopPTT(pttBtn, pttLabel));
}

/**
 * Cleanup PTT state (call on disconnect/unload)
 */
export function cleanupPTT() {
    stopAudioRecoveryMonitoring();

    if (pttStartSent && sendSignal) {
        sendSignal({ type: 'ptt-stop' });
        console.log('PTT: Cleanup - sent stop notification');
        pttStartSent = false;
    }
    pttActive = false;

    // Release persistent mic
    if (persistentMicTrack) {
        persistentMicTrack.stop();
        persistentMicTrack = null;
    }
    if (persistentMicStream) {
        persistentMicStream.getTracks().forEach(track => track.stop());
        persistentMicStream = null;
    }

    // Release fallback stream
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
    }

    builtInMicDeviceId = null;
}

// Getters
export function isPTTActive() { return pttActive; }
