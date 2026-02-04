/**
 * Push-to-Talk functionality for receiver
 * Audio ducking and renegotiation
 */

// Audio ducking constant
const DUCKING_VOLUME = 0.15;

// State
let pttStream = null;  // Kept alive between PTT presses to avoid Bluetooth issues
let pttActive = false;
let preDuckVolume = null;

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
    preDuckVolume = remoteVideo.volume;
    remoteVideo.volume = Math.min(remoteVideo.volume, DUCKING_VOLUME);
    console.log('PTT: Ducked audio from', preDuckVolume, 'to', remoteVideo.volume);

    // Notify sender that PTT is starting
    sendSignal({ type: 'ptt-start' });
    pttStartSent = true;
    console.log('PTT: Sent start notification');

    try {
        // Reuse existing mic stream if available (avoids Bluetooth profile switch)
        if (!pttStream) {
            console.log('PTT: Requesting microphone...');
            pttStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            console.log('PTT: Got microphone (keeping alive for future PTT)');
        } else {
            console.log('PTT: Reusing existing microphone stream');
        }

        // Use replaceTrack for instant audio - no renegotiation needed!
        const audioTrack = pttStream.getAudioTracks()[0];
        await pttSender.replaceTrack(audioTrack);
        console.log('PTT: Replaced track - audio now flowing');

    } catch (err) {
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
        remoteVideo.volume = preDuckVolume;
        console.log('PTT: Restored audio to', preDuckVolume);
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

    // Don't stop the microphone - keep it alive to avoid Bluetooth profile switch
    // The replaceTrack(null) above already stopped audio from being sent
    console.log('PTT: Stopped (mic kept alive)');
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
}

// Getters
export function isPTTActive() { return pttActive; }
