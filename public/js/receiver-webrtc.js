/**
 * Receiver WebRTC functionality
 * Handles answer creation, offer handling
 */

import { rtcConfig, addIceCandidates } from './webrtc.js';

// State
let peerConnection = null;
let pendingCandidates = [];
let pttAudioSender = null; // Pre-negotiated sender for PTT audio

// Stale stream detection state
let staleCheckInterval = null;
let lastBytesReceived = 0;
let staleSinceTime = null;
const STALE_THRESHOLD_MS = 5000; // 5 seconds with no new bytes = stale

// Callbacks
let sendSignal = null;
let onConnectionStateChange = null;
let onTrack = null;
let onStreamStale = null;

/**
 * Initialize receiver WebRTC
 * @param {object} callbacks
 */
export function initReceiverWebRTC(callbacks) {
    sendSignal = callbacks.sendSignal;
    onConnectionStateChange = callbacks.onConnectionStateChange;
    onTrack = callbacks.onTrack;
    onStreamStale = callbacks.onStreamStale;
}

/**
 * Handle incoming offer from sender
 * @param {RTCSessionDescriptionInit} offer
 */
export async function handleOffer(offer, pttMid = null) {
    console.log('Handling offer...');
    closePeerConnection();

    pendingCandidates = [];

    peerConnection = new RTCPeerConnection(rtcConfig);
    console.log('Created peer connection');

    peerConnection.ontrack = (event) => {
        console.log('Received track:', event.track.kind, event.streams);

        // Minimize jitter buffer for low latency playback
        // playoutDelayHint is in seconds - 0 means minimum possible delay
        if (event.receiver && 'playoutDelayHint' in event.receiver) {
            event.receiver.playoutDelayHint = 0;
            console.log('Set playoutDelayHint to 0 for low latency');
        }

        // Also try jitterBufferTarget if available (newer API)
        if (event.receiver && 'jitterBufferTarget' in event.receiver) {
            event.receiver.jitterBufferTarget = 0;
            console.log('Set jitterBufferTarget to 0');
        }

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
        if (peerConnection.connectionState === 'connected') {
            startStaleStreamDetection();
        } else if (peerConnection.connectionState === 'disconnected' ||
                   peerConnection.connectionState === 'failed' ||
                   peerConnection.connectionState === 'closed') {
            stopStaleStreamDetection();
        }
        if (onConnectionStateChange) {
            onConnectionStateChange(peerConnection.connectionState);
        }
    };

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Set remote description');

        // Set up bidirectional audio for PTT (pre-negotiate so no renegotiation needed later)
        const transceivers = peerConnection.getTransceivers();
        console.log('Transceivers after setRemoteDescription:', transceivers.length);

        let pttTransceiver = null;
        if (pttMid) {
            pttTransceiver = transceivers.find(t => t.mid === pttMid);
            if (pttTransceiver) {
                console.log('Using PTT transceiver from mid:', pttMid);
            } else {
                console.log('PTT mid not found in transceivers:', pttMid);
            }
        }

        if (pttTransceiver) {
            pttTransceiver.direction = 'sendonly';
            pttAudioSender = pttTransceiver.sender;
            console.log('Set PTT transceiver to sendonly');
        } else {
            // Fallback: use any audio transceiver (legacy behavior)
            let audioTransceiver = transceivers.find(t => t.receiver?.track?.kind === 'audio');
            if (audioTransceiver) {
                audioTransceiver.direction = 'sendrecv';
                pttAudioSender = audioTransceiver.sender;
                console.log('Set audio transceiver to sendrecv for PTT (fallback)');
            } else {
                // Last resort: create a new audio transceiver (may be ignored by offer)
                console.log('No audio transceiver found, creating one for PTT');
                const transceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
                pttAudioSender = transceiver.sender;
            }
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
 * Start monitoring for stale stream (no bytes received)
 */
function startStaleStreamDetection() {
    stopStaleStreamDetection();
    lastBytesReceived = 0;
    staleSinceTime = null;

    staleCheckInterval = setInterval(async () => {
        if (!peerConnection || peerConnection.connectionState !== 'connected') {
            return;
        }

        try {
            const stats = await peerConnection.getStats();
            let totalBytesReceived = 0;

            stats.forEach(report => {
                // Check inbound-rtp stats for received bytes
                if (report.type === 'inbound-rtp' && report.bytesReceived) {
                    totalBytesReceived += report.bytesReceived;
                }
            });

            const now = Date.now();

            if (totalBytesReceived > lastBytesReceived) {
                // Data is flowing
                if (staleSinceTime !== null) {
                    console.log('Stream recovered - bytes flowing again');
                    staleSinceTime = null;
                    if (onStreamStale) onStreamStale(false);
                }
                lastBytesReceived = totalBytesReceived;
            } else {
                // No new bytes received
                if (staleSinceTime === null) {
                    staleSinceTime = now;
                    console.log('Stream may be stale - no new bytes received');
                } else if (now - staleSinceTime >= STALE_THRESHOLD_MS) {
                    console.log('Stream is stale - no bytes for', STALE_THRESHOLD_MS, 'ms');
                    if (onStreamStale) onStreamStale(true);
                }
            }
        } catch (err) {
            console.error('Error checking stream stats:', err);
        }
    }, 1000); // Check every second
}

/**
 * Stop stale stream detection
 */
function stopStaleStreamDetection() {
    if (staleCheckInterval) {
        clearInterval(staleCheckInterval);
        staleCheckInterval = null;
    }
    staleSinceTime = null;
}

/**
 * Close peer connection
 */
export function closePeerConnection() {
    stopStaleStreamDetection();
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    pttAudioSender = null;
    pendingCandidates = [];
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
