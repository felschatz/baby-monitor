/**
 * Push-to-Talk functionality for receiver
 * Audio ducking and renegotiation
 */

// Audio ducking constant
const DUCKING_VOLUME = 0.15;

// State
let pttStream = null;
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
        console.log('PTT: Not connected');
        return;
    }

    // Add visual feedback immediately
    pttBtn.classList.add('active');
    pttLabel.textContent = 'Speaking...';

    const pttSender = getPTTAudioSender?.();
    if (!pttSender) {
        console.log('PTT: No audio sender available (connection not ready)');
        pttBtn.classList.remove('active');
        pttLabel.textContent = 'Hold to talk to baby';
        return;
    }

    pttActive = true;

    try {

        // Audio ducking - lower baby audio to prevent echo
        preDuckVolume = remoteVideo.volume;
        remoteVideo.volume = Math.min(remoteVideo.volume, DUCKING_VOLUME);
        console.log('PTT: Ducked audio from', preDuckVolume, 'to', remoteVideo.volume);

        // Notify sender that PTT is starting
        sendSignal({ type: 'ptt-start' });
        console.log('PTT: Sent start notification');

        // Get microphone access
        console.log('PTT: Requesting microphone...');
        pttStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        console.log('PTT: Got microphone');

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
    if (!pttActive) return;
    pttActive = false;

    console.log('PTT: Stopping...');
    pttBtn.classList.remove('active');
    pttLabel.textContent = 'Hold to talk to baby';

    // Restore audio volume (un-duck)
    if (preDuckVolume !== null) {
        remoteVideo.volume = preDuckVolume;
        console.log('PTT: Restored audio to', preDuckVolume);
        preDuckVolume = null;
    }

    // Notify sender that PTT has stopped
    sendSignal({ type: 'ptt-stop' });
    console.log('PTT: Sent stop notification');

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

    console.log('PTT: Stopped');
}

/**
 * Setup PTT button event listeners
 * @param {HTMLElement} pttBtn
 * @param {HTMLElement} pttLabel
 */
export function setupPTTButton(pttBtn, pttLabel) {
    // Mouse events
    pttBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startPTT(pttBtn, pttLabel);
    });

    pttBtn.addEventListener('mouseup', () => stopPTT(pttBtn, pttLabel));
    pttBtn.addEventListener('mouseleave', () => stopPTT(pttBtn, pttLabel));

    // Touch events
    pttBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startPTT(pttBtn, pttLabel);
    });

    pttBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopPTT(pttBtn, pttLabel);
    });

    pttBtn.addEventListener('touchcancel', () => stopPTT(pttBtn, pttLabel));
}

// Getters
export function isPTTActive() { return pttActive; }
