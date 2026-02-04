/**
 * Push-to-Talk functionality for receiver
 * Audio ducking for PTT
 *
 * Microphone is acquired on-demand when PTT is pressed, not pre-acquired.
 * This avoids issues with Bluetooth profile switches at page load, but means
 * the first PTT press may trigger an A2DP → HFP switch on some devices.
 *
 * BLUETOOTH MODE: When enabled, PTT signals are sent but NO microphone is acquired.
 * This prevents the A2DP→HFP profile switch that breaks audio playback on Bluetooth.
 * In this mode, the sender can see that PTT is active but won't receive audio.
 *
 * AUDIO RECOVERY: If mic acquisition disrupts playback (detected via video state),
 * we attempt to recover by resuming video playback.
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
let bluetoothMode = false; // When true, skip microphone acquisition entirely
let bluetoothAudioOutputDetected = false; // Track if Bluetooth output is detected
let lastPlaybackTime = 0; // For recovery if playback breaks

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

    // Detect Bluetooth audio output on init
    detectBluetoothAudioOutput();

    // Re-check on device changes
    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            detectBluetoothAudioOutput();
            builtInMicDeviceId = null; // Reset mic cache on device change
        });
    }
}

/**
 * Detect if Bluetooth audio output is currently active
 */
async function detectBluetoothAudioOutput() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

        // Expanded list of Bluetooth device keywords
        const btKeywords = [
            'bluetooth', 'bt ', 'bt-', 'wireless', 'airpod', 'galaxy buds',
            'jabra', 'bose', 'sony wh', 'sony wf', 'beats', 'jbl', 'buds',
            'sennheiser', 'pixel buds', 'nothing ear', 'anker', 'soundcore',
            'marshall', 'bang', 'b&o', 'akg', 'audio-technica', 'skullcandy',
            'jaybird', 'powerbeats', 'wf-', 'wh-', 'earbuds', 'headphone'
        ];

        const btOutputs = audioOutputs.filter(d => {
            const label = d.label.toLowerCase();
            return btKeywords.some(kw => label.includes(kw));
        });

        bluetoothAudioOutputDetected = btOutputs.length > 0;
        console.log('PTT: Bluetooth audio output detected:', bluetoothAudioOutputDetected,
            btOutputs.length > 0 ? `(${btOutputs.map(d => d.label).join(', ')})` : '');

        return bluetoothAudioOutputDetected;
    } catch (err) {
        console.log('PTT: Could not detect audio outputs:', err);
        return false;
    }
}

/**
 * Check if Bluetooth audio output is detected
 */
export function isBluetoothAudioDetected() {
    return bluetoothAudioOutputDetected;
}

/**
 * Set Bluetooth mode - when enabled, PTT signals are sent but mic is not acquired.
 * This prevents Bluetooth A2DP→HFP profile switches that break audio playback.
 * @param {boolean} enabled
 */
export function setBluetoothMode(enabled) {
    bluetoothMode = enabled;
    console.log('PTT: Bluetooth mode', enabled ? 'enabled' : 'disabled');
}

/**
 * Get current Bluetooth mode state
 */
export function getBluetoothMode() {
    return bluetoothMode;
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
            // Only one mic available - use it but warn if it looks like Bluetooth
            if (audioInputs.length === 1) {
                const label = audioInputs[0].label.toLowerCase();
                const btKeywords = [
                    'bluetooth', 'bt ', 'bt-', 'wireless', 'airpod', 'galaxy buds',
                    'jabra', 'bose', 'sony wh', 'sony wf', 'beats', 'jbl', 'buds',
                    'sennheiser', 'pixel buds', 'nothing ear', 'anker', 'soundcore'
                ];
                if (btKeywords.some(kw => label.includes(kw))) {
                    console.log('PTT: Only Bluetooth mic available - may trigger profile switch');
                    return null; // Return null to use default, which may work better
                }
            }
            return null;
        }

        // Expanded list of Bluetooth device keywords for microphones
        const btKeywords = [
            'bluetooth', 'bt ', 'bt-', 'wireless', 'airpod', 'galaxy buds',
            'jabra', 'bose', 'sony wh', 'sony wf', 'beats', 'jbl', 'buds',
            'sennheiser', 'pixel buds', 'nothing ear', 'anker', 'soundcore',
            'marshall', 'bang', 'b&o', 'akg', 'audio-technica', 'skullcandy',
            'jaybird', 'powerbeats', 'wf-', 'wh-', 'earbuds', 'headset', 'headphone'
        ];

        // Keywords that indicate a built-in/wired microphone
        const builtInKeywords = [
            'built-in', 'internal', 'integrated', 'default', 'front', 'back',
            'bottom', 'top', 'camcorder', 'camera', 'speakerphone', 'phone'
        ];

        // First, try to find something explicitly built-in
        const builtInMics = audioInputs.filter(d => {
            const label = d.label.toLowerCase();
            return builtInKeywords.some(kw => label.includes(kw)) &&
                   !btKeywords.some(kw => label.includes(kw));
        });

        if (builtInMics.length > 0) {
            const chosen = builtInMics[0];
            console.log('PTT: Found built-in mic:', chosen.label || chosen.deviceId);
            return chosen.deviceId;
        }

        // Otherwise, filter out Bluetooth devices
        const nonBtDevices = audioInputs.filter(d => {
            const label = d.label.toLowerCase();
            return !btKeywords.some(kw => label.includes(kw));
        });

        if (nonBtDevices.length > 0) {
            const chosen = nonBtDevices[0];
            console.log('PTT: Selected non-Bluetooth mic:', chosen.label || chosen.deviceId);
            return chosen.deviceId;
        }

        console.log('PTT: Could not identify built-in mic, all mics appear to be Bluetooth');
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
 * Try to recover audio playback if it was disrupted by mic acquisition
 */
async function tryRecoverPlayback() {
    if (!remoteVideo) return;

    // Check if video is paused or muted unexpectedly
    if (remoteVideo.paused || remoteVideo.muted) {
        console.log('PTT: Attempting to recover playback...');
        remoteVideo.muted = false;
        try {
            await remoteVideo.play();
            console.log('PTT: Playback recovered');
        } catch (e) {
            console.log('PTT: Could not recover playback:', e.message);
        }
    }

    // Restore volume if it was reset
    if (preDuckVolume !== null && remoteVideo.volume < DUCKING_VOLUME) {
        remoteVideo.volume = DUCKING_VOLUME;
    }
}

/**
 * Start push-to-talk
 * In normal mode: Acquires microphone on-demand (may trigger Bluetooth profile switch)
 * In Bluetooth mode: Only sends signal, no mic acquisition (prevents profile switch)
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

    // In Bluetooth mode, we don't need a sender - just sending the signal
    const pttSender = getPTTAudioSender?.();
    if (!bluetoothMode && !pttSender) {
        console.log('PTT: No audio sender available (connection not ready)');
        return;
    }

    // All checks passed - activate PTT
    pttActive = true;
    pttBtn.classList.add('active');

    if (bluetoothMode) {
        pttLabel.textContent = 'Alerting sender...';
        console.log('PTT: Bluetooth mode - signal only, no mic');
    } else {
        pttLabel.textContent = 'Speaking...';
    }

    // Audio ducking - lower baby audio to prevent echo
    // Use video element volume directly (no Web Audio routing for Bluetooth compatibility)
    preDuckVolume = remoteVideo.volume;
    remoteVideo.volume = Math.min(remoteVideo.volume, DUCKING_VOLUME);
    console.log('PTT: Ducked volume from', preDuckVolume, 'to', remoteVideo.volume);

    // Notify sender that PTT is starting (sent in both modes)
    sendSignal({ type: 'ptt-start', bluetoothMode: bluetoothMode });
    pttStartSent = true;
    console.log('PTT: Sent start notification, bluetoothMode:', bluetoothMode);

    // In Bluetooth mode, skip microphone acquisition entirely
    if (bluetoothMode) {
        return;
    }

    // Save playback state before mic acquisition (for recovery)
    const wasPlaying = !remoteVideo.paused;
    lastPlaybackTime = remoteVideo.currentTime;

    try {
        const constraints = await getMicConstraints();
        console.log('PTT: Acquiring microphone with constraints:', JSON.stringify(constraints.audio));
        pttStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('PTT: Got microphone');

        // Check if playback was disrupted and try to recover
        if (wasPlaying && remoteVideo.paused) {
            console.log('PTT: Playback was disrupted by mic acquisition, recovering...');
            await tryRecoverPlayback();
        }

        const audioTrack = pttStream.getAudioTracks()[0];
        console.log('PTT: Mic track label:', audioTrack.label);
        await pttSender.replaceTrack(audioTrack);
        console.log('PTT: Replaced track - audio now flowing');

        // Final playback check after track replacement
        setTimeout(tryRecoverPlayback, 100);

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

                // Check if playback was disrupted
                if (wasPlaying && remoteVideo.paused) {
                    await tryRecoverPlayback();
                }

                const audioTrack = pttStream.getAudioTracks()[0];
                console.log('PTT: Fallback mic track label:', audioTrack.label);
                await pttSender.replaceTrack(audioTrack);
                console.log('PTT: Fallback mic active - audio now flowing');

                setTimeout(tryRecoverPlayback, 100);
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
 * Releases microphone (if acquired) and restores volume
 * @param {HTMLElement} pttBtn
 * @param {HTMLElement} pttLabel
 */
export async function stopPTT(pttBtn, pttLabel) {
    // Always reset visual state
    pttBtn.classList.remove('active');
    pttLabel.textContent = bluetoothMode ? 'Hold to alert sender' : 'Hold to talk to baby';

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

    // In Bluetooth mode, no mic was acquired - skip cleanup
    if (bluetoothMode) {
        console.log('PTT: Stopped (Bluetooth mode - no mic to clean up)');
        return;
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
