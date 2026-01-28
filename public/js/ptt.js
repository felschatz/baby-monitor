/**
 * Push-to-Talk functionality for receiver
 * Audio ducking and renegotiation
 */

// Audio ducking constant
const DUCKING_VOLUME = 0.15;

// State
let pttStream = null;
let pttSender = null;
let pttActive = false;
let preDuckVolume = null;

// Dependencies
let peerConnection = null;
let remoteVideo = null;
let sendSignal = null;
let getIsConnected = null;

/**
 * Initialize PTT module
 * @param {object} deps
 */
export function initPTT(deps) {
    remoteVideo = deps.remoteVideo;
    sendSignal = deps.sendSignal;
    getIsConnected = deps.getIsConnected;
}

/**
 * Set the peer connection (call when connection changes)
 */
export function setPeerConnection(pc) {
    peerConnection = pc;
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
    if (!peerConnection || !getIsConnected()) {
        console.log('PTT: No peer connection or not connected');
        return;
    }

    pttActive = true;

    try {
        pttBtn.classList.add('active');
        pttLabel.textContent = 'Speaking...';

        // Audio ducking - lower baby audio to prevent echo
        preDuckVolume = remoteVideo.volume;
        remoteVideo.volume = Math.min(remoteVideo.volume, DUCKING_VOLUME);
        console.log('PTT: Ducked audio from', preDuckVolume, 'to', remoteVideo.volume);

        // Immediately notify sender that PTT is starting
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

        // Add audio track to peer connection
        const audioTrack = pttStream.getAudioTracks()[0];
        pttSender = peerConnection.addTrack(audioTrack, pttStream);
        console.log('PTT: Added track to peer connection');

        // Renegotiate connection
        console.log('PTT: Creating offer, signaling state:', peerConnection.signalingState);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        console.log('PTT: Offer created');

        const message = {
            type: 'ptt-offer',
            offer: peerConnection.localDescription
        };
        console.log('PTT: Sending to server:', message.type);
        sendSignal(message);
        console.log('PTT: Sent to server');

        console.log('PTT: Started, waiting for answer...');
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
export function stopPTT(pttBtn, pttLabel) {
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

    // Stop microphone
    if (pttStream) {
        pttStream.getTracks().forEach(track => track.stop());
        pttStream = null;
        console.log('PTT: Microphone stopped');
    }

    // Remove track from peer connection
    if (pttSender && peerConnection) {
        try {
            peerConnection.removeTrack(pttSender);
            console.log('PTT: Track removed from peer connection');
        } catch (e) {
            console.log('PTT: Could not remove track:', e);
        }
        pttSender = null;
    }

    console.log('PTT: Stopped');
}

/**
 * Handle PTT answer from sender
 * @param {RTCSessionDescriptionInit} answer
 */
export async function handlePTTAnswer(answer) {
    console.log('Received PTT answer');
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('PTT renegotiation complete');
        } catch (err) {
            console.error('PTT answer error:', err);
        }
    }
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
