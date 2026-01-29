/**
 * Sender WebRTC functionality
 * Handles offer creation, stream handling, and PTT receive
 */

import { rtcConfig, waitForStableState, addIceCandidates, getMediaConstraints, optimizeSdpForLowLatency } from './webrtc.js';

// State
let peerConnection = null;
let localStream = null;
let pendingCandidates = [];
let receiverWantsVideo = true;
let audioContext = null;
let analyser = null;

// PTT state
let pttActive = false;
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
 * @returns {Promise<MediaStream>}
 */
export async function startStreaming(options) {
    const { video, audio, quality, videoElement } = options;

    const constraints = getMediaConstraints({ video, audio, quality });
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = localStream;

    console.log('Got local stream');
    console.log('Video tracks:', localStream.getVideoTracks().length);
    console.log('Audio tracks:', localStream.getAudioTracks().length);

    if (localStream.getVideoTracks().length > 0) {
        const videoTrack = localStream.getVideoTracks()[0];
        console.log('Video track settings:', videoTrack.getSettings());
    }

    return localStream;
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
 * Create and send WebRTC offer
 * @param {HTMLAudioElement} pttAudio - PTT audio element
 */
export async function createOffer(pttAudio) {
    if (peerConnection) {
        peerConnection.close();
    }

    pendingCandidates = [];
    peerConnection = new RTCPeerConnection(rtcConfig);
    console.log('Created new peer connection');

    localStream.getTracks().forEach(track => {
        if (track.kind === 'video' && !receiverWantsVideo) {
            console.log('Skipping video track (receiver requested audio-only)');
            return;
        }
        const sender = peerConnection.addTrack(track, localStream);
        console.log('Added track:', track.kind);

        // Configure audio sender for low latency
        if (track.kind === 'audio' && sender.getParameters) {
            try {
                const params = sender.getParameters();
                if (params.encodings && params.encodings.length > 0) {
                    // Set priority to high for lower queuing delay
                    params.encodings[0].priority = 'high';
                    params.encodings[0].networkPriority = 'high';
                    sender.setParameters(params).then(() => {
                        console.log('Set audio encoding priority to high');
                    }).catch(e => console.log('Could not set audio priority:', e.message));
                }
            } catch (e) {
                console.log('Could not configure audio sender:', e.message);
            }
        }
    });

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
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (onConnectionStateChange) {
            onConnectionStateChange(peerConnection.connectionState);
        }
    };

    // Store PTT audio stream reference for reuse
    let pttMediaStream = null;

    // Handle incoming audio from parent (PTT)
    peerConnection.ontrack = (event) => {
        console.log('Received track from parent:', event.track.kind, 'streams:', event.streams.length, 'muted:', event.track.muted, 'readyState:', event.track.readyState);

        // Minimize jitter buffer for low latency PTT playback
        if (event.receiver && 'playoutDelayHint' in event.receiver) {
            event.receiver.playoutDelayHint = 0;
            console.log('Set PTT playoutDelayHint to 0');
        }

        // Check if this is an audio track (PTT from parent)
        if (event.track.kind === 'audio') {
            // With replaceTrack/pre-negotiated tracks, streams may be empty
            // Create a MediaStream from the track if needed
            pttMediaStream = event.streams[0] || new MediaStream([event.track]);

            console.log('PTT audio track received, setting up playback. Track muted:', event.track.muted);
            pttAudio.srcObject = pttMediaStream;

            // Function to try playing audio
            const tryPlay = () => {
                if (!pttAudio.srcObject) return;
                pttAudio.play().then(() => {
                    console.log('PTT audio playing successfully');
                }).catch(err => {
                    console.log('PTT audio play error (will retry on unmute):', err.message);
                });
            };

            // Try to play if track is not muted
            if (!event.track.muted) {
                tryPlay();
            }

            event.track.onended = () => {
                console.log('PTT track ended');
                pttActive = false;
            };

            event.track.onmute = () => {
                console.log('PTT track muted (parent stopped talking)');
            };

            event.track.onunmute = () => {
                console.log('PTT track unmuted (parent started talking), pttActive:', pttActive);
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
        console.log('Created and set local offer (low-latency optimized)');

        if (sendSignal) {
            sendSignal({
                type: 'offer',
                offer: peerConnection.localDescription
            });
            console.log('Sent offer to server');
        }
    } catch (err) {
        console.error('Error creating offer:', err);
    }
}

/**
 * Handle answer from receiver
 * @param {RTCSessionDescriptionInit} answer
 */
export async function handleAnswer(answer) {
    if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Remote description set');

            console.log('Processing', pendingCandidates.length, 'queued ICE candidates');
            await addIceCandidates(peerConnection, pendingCandidates);
            pendingCandidates = [];
        } catch (err) {
            console.error('Error setting remote description:', err);
        }
    }
}

/**
 * Handle ICE candidate from receiver
 * @param {RTCIceCandidateInit} candidate
 */
export async function handleIceCandidate(candidate) {
    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('Added ICE candidate from receiver');
        } catch (err) {
            console.log('ICE candidate skipped (may be from old session)');
        }
    } else {
        console.log('Queuing ICE candidate from receiver');
        pendingCandidates.push(candidate);
    }
}

/**
 * Handle PTT offer from parent
 * @param {RTCSessionDescriptionInit} offer
 */
export async function handlePTTOffer(offer) {
    if (!peerConnection) {
        console.log('No peer connection for PTT');
        return;
    }

    try {
        console.log('Processing PTT offer, signaling state:', peerConnection.signalingState);

        await waitForStableState(peerConnection);

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Set remote description for PTT');

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Created PTT answer');

        if (sendSignal) {
            sendSignal({
                type: 'ptt-answer',
                answer: peerConnection.localDescription
            });
            console.log('Sent PTT answer');
        }
    } catch (err) {
        console.error('PTT offer error:', err);
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

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    videoElement.srcObject = null;
    receiverWantsVideo = true;
}

/**
 * Replace audio track in peer connection
 * @param {MediaStreamTrack} newTrack
 */
export async function replaceAudioTrack(newTrack) {
    if (!peerConnection || !newTrack) return;

    const senders = peerConnection.getSenders();
    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

    if (audioSender) {
        try {
            await audioSender.replaceTrack(newTrack);
            console.log('Replaced audio track');
        } catch (err) {
            console.error('Failed to replace audio track:', err);
        }
    }
}

// PTT indicator helpers
export function showPTTIndicator(indicatorElement) {
    if (pttTimeout) {
        clearTimeout(pttTimeout);
    }
    indicatorElement.classList.add('active');

    pttTimeout = setTimeout(() => {
        console.log('PTT timeout - hiding indicator');
        hidePTTIndicator(indicatorElement);
    }, PTT_TIMEOUT_MS);
}

export function hidePTTIndicator(indicatorElement) {
    if (pttTimeout) {
        clearTimeout(pttTimeout);
        pttTimeout = null;
    }
    indicatorElement.classList.remove('active');
}

// Getters and setters
export function getLocalStream() { return localStream; }
export function getPeerConnection() { return peerConnection; }
export function getAudioContext() { return audioContext; }
export function setReceiverWantsVideo(value) { receiverWantsVideo = value; }
export function getReceiverWantsVideo() { return receiverWantsVideo; }
export function setPttActive(value) { pttActive = value; }
export function isPttActive() { return pttActive; }
