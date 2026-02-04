/**
 * Push-to-Talk functionality for receiver
 * Audio ducking and renegotiation
 *
 * Uses the phone's built-in microphone (not Bluetooth) to avoid
 * Bluetooth profile switches (A2DP ↔ HFP) that disrupt audio playback.
 */

import {
    isAudioRoutedThroughWebAudio,
    setPlaybackVolume,
    getPlaybackVolume
} from './audio-analysis.js';

// Audio ducking constant
const DUCKING_VOLUME = 0.15;

// State
let pttStream = null;
let pttActive = false;
let preDuckVolume = null;
let builtInMicDeviceId = null; // Cached built-in mic device ID

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
 * This prevents Bluetooth A2DP → HFP profile switches when capturing audio.
 * Returns null if no non-Bluetooth mic is found (will fall back to default).
 */
async function findBuiltInMic() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        console.log('PTT: Available audio inputs:', audioInputs.map(d => `${d.label} (${d.deviceId.substring(0, 8)}...)`));

        if (audioInputs.length <= 1) {
            // Only one mic available, nothing to filter
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

        // All devices look like Bluetooth - fall back to default
        console.log('PTT: Could not identify built-in mic, will use default');
        return null;
    } catch (err) {
        console.log('PTT: Could not enumerate devices:', err);
        return null;
    }
}

/**
 * Recover audio playback after getUserMedia disrupts audio output routing.
 * Re-assigns srcObject to force the browser to re-evaluate the output device.
 */
function recoverAudioPlayback() {
    if (!remoteVideo || !remoteVideo.srcObject) return;

    const stream = remoteVideo.srcObject;
    remoteVideo.srcObject = null;
    remoteVideo.srcObject = stream;
    remoteVideo.play().catch(e => console.log('PTT: Audio recovery play failed:', e));
    console.log('PTT: Audio playback recovered');
}

/**
 * Get microphone constraints that prefer the built-in mic over Bluetooth.
 */
async function getMicConstraints() {
    // Cache the device ID lookup
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
        // Use exact to force built-in mic, preventing Bluetooth profile switch
        constraints.audio.deviceId = { exact: builtInMicDeviceId };
    }

    return constraints;
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
        const constraints = await getMicConstraints();
        console.log('PTT: Requesting microphone with constraints:', JSON.stringify(constraints.audio.deviceId || 'default'));
        pttStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('PTT: Got microphone');

        // getUserMedia may disrupt audio output routing - recover after settling
        setTimeout(recoverAudioPlayback, 200);

        // Use replaceTrack for instant audio - no renegotiation needed!
        const audioTrack = pttStream.getAudioTracks()[0];
        await pttSender.replaceTrack(audioTrack);
        console.log('PTT: Replaced track - audio now flowing');

    } catch (err) {
        // If exact device constraint fails, retry without device preference
        if (err.name === 'OverconstrainedError' && builtInMicDeviceId) {
            console.log('PTT: Built-in mic not available, falling back to default');
            builtInMicDeviceId = ''; // Clear cache so we don't retry
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
                setTimeout(recoverAudioPlayback, 200);
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

    // Stop microphone
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
        console.log('PTT: Microphone stopped');
    }

    // Stopping the mic may change audio output routing - recover after settling
    setTimeout(recoverAudioPlayback, 500);

    console.log('PTT: Stopped');
}

/**
 * Setup PTT button event listeners
 * @param {HTMLElement} pttBtn
 * @param {HTMLElement} pttLabel
 */
export function setupPTTButton(pttBtn, pttLabel) {
    console.log('PTT: Button setup complete');

    // Check microphone permission on setup
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(result => {
            console.log('PTT: Microphone permission state:', result.state);
            // If permission already granted, pre-discover the built-in mic
            if (result.state === 'granted') {
                findBuiltInMic().then(id => {
                    builtInMicDeviceId = id || '';
                    console.log('PTT: Pre-cached built-in mic:', builtInMicDeviceId ? 'found' : 'using default');
                });
            }
            result.onchange = () => {
                console.log('PTT: Microphone permission changed to:', result.state);
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
    // Send ptt-stop if we had started
    if (pttStartSent && sendSignal) {
        sendSignal({ type: 'ptt-stop' });
        console.log('PTT: Cleanup - sent stop notification');
        pttStartSent = false;
    }
    pttActive = false;

    // Stop microphone if active
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
    }

    // Clear cached device ID so it's re-discovered next time
    builtInMicDeviceId = null;
}

// Getters
export function isPTTActive() { return pttActive; }
