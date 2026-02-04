/**
 * Push-to-Talk functionality for receiver
 * Audio ducking for PTT
 *
 * Microphone is acquired on-demand when PTT is pressed, not pre-acquired.
 * This avoids issues with Bluetooth profile switches at page load, but means
 * the first PTT press may trigger an A2DP → HFP switch on some devices.
 */

import {
    getPlaybackVolume,
    setPlaybackVolume
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
 * Start push-to-talk
 * Acquires microphone on-demand (may trigger Bluetooth profile switch)
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
    // Use video element volume directly (no Web Audio routing for Bluetooth compatibility)
    preDuckVolume = remoteVideo.volume;
    remoteVideo.volume = Math.min(remoteVideo.volume, DUCKING_VOLUME);
    console.log('PTT: Ducked volume from', preDuckVolume, 'to', remoteVideo.volume);

    // Notify sender that PTT is starting
    sendSignal({ type: 'ptt-start' });
    pttStartSent = true;
    console.log('PTT: Sent start notification');

    try {
        const constraints = await getMicConstraints();
        pttStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('PTT: Got microphone');

        const audioTrack = pttStream.getAudioTracks()[0];
        await pttSender.replaceTrack(audioTrack);
        console.log('PTT: Replaced track - audio now flowing');

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
 * Releases microphone and restores volume
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
        remoteVideo.volume = preDuckVolume;
        console.log('PTT: Restored volume to', preDuckVolume);
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

    // Stop and release the microphone
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
        console.log('PTT: Mic stopped');
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
    if (pttStartSent && sendSignal) {
        sendSignal({ type: 'ptt-stop' });
        console.log('PTT: Cleanup - sent stop notification');
        pttStartSent = false;
    }
    pttActive = false;

    // Release microphone stream
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
    }

    builtInMicDeviceId = null;
}

// Getters
export function isPTTActive() { return pttActive; }
