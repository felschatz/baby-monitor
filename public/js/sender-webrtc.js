/**
 * Sender WebRTC functionality
 * Handles offer creation, stream handling, and PTT receive
 * Supports multiple simultaneous receivers
 */

import { rtcConfig, waitForStableState, addIceCandidates, getMediaConstraints, optimizeSdpForLowLatency } from './webrtc.js';

// State - now using Maps to support multiple receivers
const peerConnections = new Map(); // receiverId -> RTCPeerConnection
const pendingCandidates = new Map(); // receiverId -> ICECandidate[]
const receiverVideoPrefs = new Map(); // receiverId -> boolean (wants video)

let localStream = null;
let videoAvailable = true; // Track if video capture is available
let audioContext = null;
let analyser = null;

// PTT state per receiver
const pttActiveReceivers = new Set(); // Set of receiverIds with active PTT
let pttTimeout = null;
const PTT_TIMEOUT_MS = 30000;

// Callbacks
let sendSignal = null;
let onConnectionStateChange = null;

/**
 * Initialize sender WebRTC
 * @param {object} callbacks
 * @param {function} callbacks.sendSignal - Send signal function
 * @param {function} callbacks.onConnectionStateChange - Connection state change callback
 */
export function initSenderWebRTC(callbacks) {
    sendSignal = callbacks.sendSignal;
    onConnectionStateChange = callbacks.onConnectionStateChange;
}

/**
 * Start streaming
 * @param {object} options
 * @param {boolean} options.video - Enable video
 * @param {boolean} options.audio - Enable audio
 * @param {string} options.quality - Video quality 'sd' or 'hd'
 * @param {HTMLVideoElement} options.videoElement - Video element to display stream
 * @returns {Promise<{stream: MediaStream, videoFailed: boolean}>}
 */
export async function startStreaming(options) {
    const { video, audio, quality, videoElement } = options;

    let videoFailed = false;

    if (video) {
        // Try with video first
        try {
            const constraints = getMediaConstraints({ video: true, audio, quality });
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoAvailable = true;
        } catch (err) {
            console.warn('Video capture failed, falling back to audio-only:', err.message);
            videoFailed = true;
            videoAvailable = false;
            // Fall back to audio-only
            const audioConstraints = getMediaConstraints({ video: false, audio, quality });
            localStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        }
    } else {
        // User requested audio-only
        const constraints = getMediaConstraints({ video: false, audio, quality });
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoAvailable = true; // Don't mark as unavailable if user chose audio-only
    }

    videoElement.srcObject = localStream;

    console.log('Got local stream');
    console.log('Video tracks:', localStream.getVideoTracks().length);
    console.log('Audio tracks:', localStream.getAudioTracks().length);

    if (localStream.getVideoTracks().length > 0) {
        const videoTrack = localStream.getVideoTracks()[0];
        console.log('Video track settings:', videoTrack.getSettings());
    }

    return { stream: localStream, videoFailed };
}

/**
 * Setup audio analysis for the local stream
 * @param {MediaStream} stream
 * @param {HTMLElement} audioLevelElement
 */
export function setupAudioAnalysis(stream, audioLevelElement) {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateAudioLevel() {
        if (!analyser) return;

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const percentage = Math.min(100, (average / 128) * 100);

        audioLevelElement.style.width = percentage + '%';

        requestAnimationFrame(updateAudioLevel);
    }

    updateAudioLevel();
}

/**
 * Create and send WebRTC offer for a specific receiver
 * @param {HTMLAudioElement} pttAudio - PTT audio element
 * @param {string} receiverId - Target receiver ID
 */
export async function createOffer(pttAudio, receiverId) {
    if (!receiverId) {
        console.error('createOffer requires receiverId');
        return;
    }

    // Close existing connection for this receiver if any
    const existingPc = peerConnections.get(receiverId);
    if (existingPc) {
        console.log('Closing existing connection for receiver:', receiverId);
        existingPc.close();
        peerConnections.delete(receiverId);
    }

    pendingCandidates.set(receiverId, []);
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections.set(receiverId, peerConnection);
    console.log('Created new peer connection for receiver:', receiverId, 'total connections:', peerConnections.size);

    // Get video preference for this receiver (default to true)
    const receiverWantsVideo = receiverVideoPrefs.get(receiverId) !== false;

    localStream.getTracks().forEach(track => {
        if (track.kind === 'video' && !receiverWantsVideo) {
            console.log('Skipping video track for receiver', receiverId, '(requested audio-only)');
            return;
        }
        const sender = peerConnection.addTrack(track, localStream);
        console.log('Added track for receiver', receiverId, ':', track.kind);

        // Configure audio sender for low latency
        if (track.kind === 'audio' && sender.getParameters) {
            try {
                const params = sender.getParameters();
                if (params.encodings && params.encodings.length > 0) {
                    // Set priority to high for lower queuing delay
                    params.encodings[0].priority = 'high';
                    params.encodings[0].networkPriority = 'high';
                    sender.setParameters(params).then(() => {
                        console.log('Set audio encoding priority to high for receiver:', receiverId);
                    }).catch(e => console.log('Could not set audio priority:', e.message));
                }
            } catch (e) {
                console.log('Could not configure audio sender:', e.message);
            }
        }
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && sendSignal) {
            console.log('Sending ICE candidate to receiver:', receiverId);
            sendSignal({
                type: 'ice-candidate',
                candidate: event.candidate,
                receiverId: receiverId
            });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state for receiver', receiverId, ':', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state for receiver', receiverId, ':', peerConnection.connectionState);
        if (onConnectionStateChange) {
            // Report overall connection state (connected if any receiver is connected)
            const anyConnected = Array.from(peerConnections.values()).some(
                pc => pc.connectionState === 'connected'
            );
            onConnectionStateChange(anyConnected ? 'connected' : peerConnection.connectionState, receiverId);
        }

        // Clean up failed/closed connections
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
            console.log('Removing failed/closed connection for receiver:', receiverId);
            peerConnections.delete(receiverId);
            pendingCandidates.delete(receiverId);
            receiverVideoPrefs.delete(receiverId);
            pttActiveReceivers.delete(receiverId);
        }
    };

    // Handle incoming audio from parent (PTT)
    peerConnection.ontrack = (event) => {
        console.log('Received track from receiver', receiverId, ':', event.track.kind, 'streams:', event.streams.length, 'muted:', event.track.muted, 'readyState:', event.track.readyState);

        // Minimize jitter buffer for low latency PTT playback
        if (event.receiver && 'playoutDelayHint' in event.receiver) {
            event.receiver.playoutDelayHint = 0;
            console.log('Set PTT playoutDelayHint to 0 for receiver:', receiverId);
        }

        // Check if this is an audio track (PTT from parent)
        if (event.track.kind === 'audio') {
            // With replaceTrack/pre-negotiated tracks, streams may be empty
            // Create a MediaStream from the track if needed
            const pttMediaStream = event.streams[0] || new MediaStream([event.track]);

            console.log('PTT audio track received from receiver', receiverId, ', setting up playback. Track muted:', event.track.muted);
            pttAudio.srcObject = pttMediaStream;

            // Function to try playing audio
            const tryPlay = () => {
                if (!pttAudio.srcObject) return;
                pttAudio.play().then(() => {
                    console.log('PTT audio playing successfully from receiver:', receiverId);
                }).catch(err => {
                    console.log('PTT audio play error (will retry on unmute):', err.message);
                });
            };

            // Try to play if track is not muted
            if (!event.track.muted) {
                tryPlay();
            }

            event.track.onended = () => {
                console.log('PTT track ended from receiver:', receiverId);
                pttActiveReceivers.delete(receiverId);
            };

            event.track.onmute = () => {
                console.log('PTT track muted from receiver', receiverId, '(stopped talking)');
            };

            event.track.onunmute = () => {
                console.log('PTT track unmuted from receiver', receiverId, '(started talking)');
                // Audio started flowing - this is the key moment for pre-negotiated tracks!
                tryPlay();
            };
        }
    };

    try {
        const offer = await peerConnection.createOffer();

        // Optimize SDP for low latency audio
        const optimizedSdp = optimizeSdpForLowLatency(offer.sdp);
        const optimizedOffer = new RTCSessionDescription({
            type: offer.type,
            sdp: optimizedSdp
        });

        await peerConnection.setLocalDescription(optimizedOffer);
        console.log('Created and set local offer for receiver', receiverId, '(low-latency optimized)');

        if (sendSignal) {
            sendSignal({
                type: 'offer',
                offer: peerConnection.localDescription,
                receiverId: receiverId
            });
            console.log('Sent offer to receiver:', receiverId);
        }
    } catch (err) {
        console.error('Error creating offer for receiver', receiverId, ':', err);
    }
}

/**
 * Handle answer from receiver
 * @param {RTCSessionDescriptionInit} answer
 * @param {string} receiverId
 */
export async function handleAnswer(answer, receiverId) {
    if (!receiverId) {
        console.error('handleAnswer requires receiverId');
        return;
    }

    const peerConnection = peerConnections.get(receiverId);
    if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Remote description set for receiver:', receiverId);

            const candidates = pendingCandidates.get(receiverId) || [];
            console.log('Processing', candidates.length, 'queued ICE candidates for receiver:', receiverId);
            await addIceCandidates(peerConnection, candidates);
            pendingCandidates.set(receiverId, []);
        } catch (err) {
            console.error('Error setting remote description for receiver', receiverId, ':', err);
        }
    } else {
        console.log('No peer connection or wrong state for receiver:', receiverId, 'state:', peerConnection?.signalingState);
    }
}

/**
 * Handle ICE candidate from receiver
 * @param {RTCIceCandidateInit} candidate
 * @param {string} receiverId
 */
export async function handleIceCandidate(candidate, receiverId) {
    if (!receiverId) {
        console.error('handleIceCandidate requires receiverId');
        return;
    }

    const peerConnection = peerConnections.get(receiverId);
    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('Added ICE candidate from receiver:', receiverId);
        } catch (err) {
            console.log('ICE candidate skipped for receiver', receiverId, '(may be from old session)');
        }
    } else {
        console.log('Queuing ICE candidate from receiver:', receiverId);
        const candidates = pendingCandidates.get(receiverId) || [];
        candidates.push(candidate);
        pendingCandidates.set(receiverId, candidates);
    }
}

/**
 * Handle PTT offer from parent
 * @param {RTCSessionDescriptionInit} offer
 * @param {string} receiverId
 */
export async function handlePTTOffer(offer, receiverId) {
    if (!receiverId) {
        console.error('handlePTTOffer requires receiverId');
        return;
    }

    const peerConnection = peerConnections.get(receiverId);
    if (!peerConnection) {
        console.log('No peer connection for PTT from receiver:', receiverId);
        return;
    }

    try {
        console.log('Processing PTT offer from receiver', receiverId, ', signaling state:', peerConnection.signalingState);

        await waitForStableState(peerConnection);

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Set remote description for PTT from receiver:', receiverId);

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Created PTT answer for receiver:', receiverId);

        if (sendSignal) {
            sendSignal({
                type: 'ptt-answer',
                answer: peerConnection.localDescription,
                receiverId: receiverId
            });
            console.log('Sent PTT answer to receiver:', receiverId);
        }
    } catch (err) {
        console.error('PTT offer error for receiver', receiverId, ':', err);
    }
}

/**
 * Stop streaming
 * @param {HTMLVideoElement} videoElement
 */
export function stopStreaming(videoElement) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Close all peer connections
    peerConnections.forEach((pc, receiverId) => {
        console.log('Closing connection for receiver:', receiverId);
        pc.close();
    });
    peerConnections.clear();
    pendingCandidates.clear();
    receiverVideoPrefs.clear();
    pttActiveReceivers.clear();

    videoElement.srcObject = null;
    videoAvailable = true; // Reset for next stream attempt
}

/**
 * Replace audio track in all peer connections
 * @param {MediaStreamTrack} newTrack
 */
export async function replaceAudioTrack(newTrack) {
    if (!newTrack) return;

    const promises = [];
    peerConnections.forEach((peerConnection, receiverId) => {
        const senders = peerConnection.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

        if (audioSender) {
            const promise = audioSender.replaceTrack(newTrack)
                .then(() => console.log('Replaced audio track for receiver:', receiverId))
                .catch(err => console.error('Failed to replace audio track for receiver', receiverId, ':', err));
            promises.push(promise);
        }
    });

    await Promise.all(promises);
}

// PTT indicator helpers
export function showPTTIndicator(indicatorElement, receiverId) {
    if (receiverId) {
        pttActiveReceivers.add(receiverId);
    }
    if (pttTimeout) {
        clearTimeout(pttTimeout);
    }
    indicatorElement.classList.add('active');

    pttTimeout = setTimeout(() => {
        console.log('PTT timeout - hiding indicator');
        hidePTTIndicator(indicatorElement);
    }, PTT_TIMEOUT_MS);
}

export function hidePTTIndicator(indicatorElement, receiverId) {
    if (receiverId) {
        pttActiveReceivers.delete(receiverId);
    }
    // Only hide if no receivers have active PTT
    if (pttActiveReceivers.size === 0) {
        if (pttTimeout) {
            clearTimeout(pttTimeout);
            pttTimeout = null;
        }
        indicatorElement.classList.remove('active');
    }
}

// Getters and setters
export function getLocalStream() { return localStream; }
export function getPeerConnection(receiverId) {
    if (receiverId) {
        return peerConnections.get(receiverId);
    }
    // Return first connection for backwards compatibility
    return peerConnections.values().next().value || null;
}
export function getPeerConnections() { return peerConnections; }
export function getAudioContext() { return audioContext; }
export function setReceiverWantsVideo(value, receiverId) {
    if (receiverId) {
        receiverVideoPrefs.set(receiverId, value);
    }
}
export function getReceiverWantsVideo(receiverId) {
    if (receiverId) {
        return receiverVideoPrefs.get(receiverId) !== false;
    }
    // Return true if any receiver wants video (for UI display)
    for (const [, wantsVideo] of receiverVideoPrefs) {
        if (wantsVideo) return true;
    }
    return receiverVideoPrefs.size === 0; // Default to true if no prefs set
}
export function setPttActive(value, receiverId) {
    if (value && receiverId) {
        pttActiveReceivers.add(receiverId);
    } else if (receiverId) {
        pttActiveReceivers.delete(receiverId);
    }
}
export function isPttActive(receiverId) {
    if (receiverId) {
        return pttActiveReceivers.has(receiverId);
    }
    return pttActiveReceivers.size > 0;
}
export function isVideoAvailable() { return videoAvailable; }
export function setVideoAvailable(value) { videoAvailable = value; }
export function getConnectedReceiverCount() {
    let count = 0;
    peerConnections.forEach(pc => {
        if (pc.connectionState === 'connected') count++;
    });
    return count;
}
