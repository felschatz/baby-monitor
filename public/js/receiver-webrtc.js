/**
 * Receiver WebRTC functionality
 * Handles answer creation, offer handling
 */

import { rtcConfig, addIceCandidates } from './webrtc.js';

// State
let peerConnection = null;
let pendingCandidates = [];
let pttAudioSender = null; // Pre-negotiated sender for PTT audio

// Callbacks
let sendSignal = null;
let onConnectionStateChange = null;
let onTrack = null;

/**
 * Initialize receiver WebRTC
 * @param {object} callbacks
 */
export function initReceiverWebRTC(callbacks) {
    sendSignal = callbacks.sendSignal;
    onConnectionStateChange = callbacks.onConnectionStateChange;
    onTrack = callbacks.onTrack;
}

/**
 * Handle incoming offer from sender
 * @param {RTCSessionDescriptionInit} offer
 */
export async function handleOffer(offer) {
    console.log('Handling offer...');
    closePeerConnection();

    pendingCandidates = [];

    peerConnection = new RTCPeerConnection(rtcConfig);
    console.log('Created peer connection');

    peerConnection.ontrack = (event) => {
        console.log('Received track:', event.track.kind, event.streams);
        if (onTrack) onTrack(event);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && sendSignal) {
            console.log('Sending ICE candidate');
            sendSignal({
                type: 'ice-candidate',
                candidate: event.candidate
            });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected') {
            console.log('ICE connected! Video should work now.');
        }
        if (peerConnection.iceConnectionState === 'failed') {
            console.error('ICE connection failed - trying restart');
            peerConnection.restartIce();
        }
    };

    peerConnection.onicegatheringstatechange = () => {
        console.log('ICE gathering state:', peerConnection.iceGatheringState);
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (onConnectionStateChange) {
            onConnectionStateChange(peerConnection.connectionState);
        }
    };

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Set remote description');

        // Set up bidirectional audio for PTT (pre-negotiate so no renegotiation needed later)
        const transceivers = peerConnection.getTransceivers();
        const audioTransceiver = transceivers.find(t => t.receiver.track?.kind === 'audio');
        if (audioTransceiver) {
            audioTransceiver.direction = 'sendrecv';
            pttAudioSender = audioTransceiver.sender;
            console.log('Set audio transceiver to sendrecv for PTT');
        } else {
            // No audio transceiver from sender, create one
            const transceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
            pttAudioSender = transceiver.sender;
            console.log('Added audio transceiver for PTT');
        }

        console.log('Processing', pendingCandidates.length, 'queued ICE candidates');
        await addIceCandidates(peerConnection, pendingCandidates);
        pendingCandidates = [];

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Created and set local answer');

        if (sendSignal) {
            sendSignal({
                type: 'answer',
                answer: peerConnection.localDescription
            });
            console.log('Sent answer to server');
        }
    } catch (err) {
        console.error('Error in handleOffer:', err);
    }
}

/**
 * Handle ICE candidate from sender
 * @param {RTCIceCandidateInit} candidate
 */
export async function handleIceCandidate(candidate) {
    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('Added ICE candidate');
        } catch (err) {
            console.log('ICE candidate error (may be stale):', err.message);
        }
    } else {
        console.log('Queuing ICE candidate');
        pendingCandidates.push(candidate);
    }
}

/**
 * Close peer connection
 */
export function closePeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

/**
 * Get the current peer connection
 */
export function getPeerConnection() {
    return peerConnection;
}

/**
 * Restart ICE if needed
 */
export function restartIceIfNeeded() {
    if (peerConnection && peerConnection.connectionState === 'disconnected') {
        peerConnection.restartIce();
    }
}

/**
 * Request new offer from sender
 * @param {boolean} videoEnabled
 */
export function requestOffer(videoEnabled = true) {
    if (sendSignal) {
        sendSignal({ type: 'request-offer', videoEnabled });
    }
}

/**
 * Get the pre-negotiated PTT audio sender
 * Use replaceTrack() on this sender for instant PTT without renegotiation
 */
export function getPTTAudioSender() {
    return pttAudioSender;
}
