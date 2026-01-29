/**
 * Sender Application - Main orchestration
 * Wires together all modules for the sender page
 */

import { initKeepAwake } from './keep-awake.js';
import { initSession } from './session.js';
import { createSignalingManager } from './signaling.js';
import { initScreenDimming } from './screen-dimming.js';
import {
    initMusicPlayer,
    startMusic,
    stopMusic,
    fadeOutAndStop,
    resetMusicTimer,
    switchPlaylist,
    broadcastMusicStatus,
    isMusicPlaying,
    getMusicAudio
} from './music-player.js';
import {
    initEchoCancellation,
    setupEchoCancellation,
    teardownEchoCancellation,
    isEchoCancelEnabled,
    isEchoCancelActive,
    setEchoCancelEnabled,
    getOriginalAudioTrack,
    getProcessedAudioTrack,
    initMusicWebAudio
} from './echo-cancellation.js';
import {
    initSenderWebRTC,
    startStreaming,
    setupAudioAnalysis,
    createOffer,
    handleAnswer,
    handleIceCandidate,
    handlePTTOffer,
    stopStreaming as stopWebRTCStreaming,
    replaceAudioTrack,
    showPTTIndicator,
    hidePTTIndicator,
    getLocalStream,
    getAudioContext,
    setReceiverWantsVideo,
    getReceiverWantsVideo,
    setPttActive
} from './sender-webrtc.js';

// DOM elements
const sessionOverlay = document.getElementById('sessionOverlay');
const sessionInput = document.getElementById('sessionInput');
const sessionJoinBtn = document.getElementById('sessionJoinBtn');
const screenOffOverlay = document.getElementById('screenOffOverlay');
const dimIndicator = document.getElementById('dimIndicator');
const countdownBar = document.getElementById('countdownBar');
const localVideo = document.getElementById('localVideo');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const info = document.getElementById('info');
const audioLevel = document.getElementById('audioLevel');
const enableVideo = document.getElementById('enableVideo');
const enableAudio = document.getElementById('enableAudio');
const pttAudio = document.getElementById('pttAudio');
const pttStatus = document.getElementById('pttStatus');
const optionsPanel = document.getElementById('optionsPanel');
const streamingStatus = document.getElementById('streamingStatus');
const streamingStatusValue = document.getElementById('streamingStatusValue');
const qualityBadge = document.getElementById('qualityBadge');

// Music elements
const musicAudio = document.getElementById('musicAudio');
const musicStatusBar = document.getElementById('musicStatusBar');
const musicTrackName = document.getElementById('musicTrackName');
const musicTimerEl = document.getElementById('musicTimer');
const musicControlsPanel = document.getElementById('musicControlsPanel');
const musicBtn = document.getElementById('musicBtn');
const musicPlaylistSelect = document.getElementById('musicPlaylistSelect');
const musicTimerSelect = document.getElementById('musicTimerSelect');
const musicResetBtn = document.getElementById('musicResetBtn');
const musicVolumeSlider = document.getElementById('musicVolume');
const musicVolumeValue = document.getElementById('musicVolumeValue');
const musicLabel = document.getElementById('musicLabel');

// Extract quality setting from URL
const urlParams = new URLSearchParams(window.location.search);
const videoQuality = urlParams.get('q') === 'sd' ? 'sd' : 'hd';

// Initialize session
const sessionName = initSession({
    pathPrefix: '/s/',
    overlay: sessionOverlay,
    input: sessionInput,
    button: sessionJoinBtn,
    redirectPrefix: '/s/',
    queryString: `q=${videoQuality}`
});

// Stop execution if no session (user needs to enter session first)
if (!sessionName) {
    throw new Error('Session required');
}

// Display quality badge
qualityBadge.textContent = videoQuality.toUpperCase();
qualityBadge.classList.add(videoQuality);

// State
let isStreaming = false;
let audioEnabled = false;

// Initialize keep-awake
initKeepAwake();

// Initialize screen dimming
initScreenDimming({
    screenOffOverlay,
    dimIndicator,
    countdownBar
});

// Helper functions
function setConnectedState(connected) {
    if (connected) {
        document.body.classList.add('connected');
        document.body.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
    } else {
        document.body.classList.remove('connected');
        statusDot.classList.remove('connected');
        statusText.textContent = 'Disconnected';
    }
}

function setDisconnectedState() {
    document.body.classList.add('disconnected');
    document.body.classList.remove('connected');
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected!';
}

function updateStreamingStatus() {
    if (!isStreaming) return;

    const hasVideo = enableVideo.checked && getReceiverWantsVideo();
    const hasAudio = enableAudio.checked;

    if (hasVideo && hasAudio) {
        streamingStatusValue.textContent = 'Video + Audio';
        streamingStatusValue.className = 'status-value';
    } else if (hasVideo) {
        streamingStatusValue.textContent = 'Video only';
        streamingStatusValue.className = 'status-value';
    } else if (hasAudio) {
        streamingStatusValue.textContent = 'Audio only';
        streamingStatusValue.className = 'status-value audio-only';
    } else {
        streamingStatusValue.textContent = 'Nothing';
        streamingStatusValue.className = 'status-value';
    }
}

function enableAudioPlayback() {
    if (audioEnabled) return;
    audioEnabled = true;
    console.log('Audio playback enabled');

    const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
    silentAudio.play().catch(e => {});

    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume();
    }

    if (pttAudio.srcObject) {
        pttAudio.play().catch(e => console.log('PTT play after enable:', e));
    }
}

// Create signaling manager
const signaling = createSignalingManager({
    sessionName,
    role: 'sender',
    sseEndpoint: '/api/sse/sender',
    onMessage: handleMessage,
    onError: () => setDisconnectedState()
});

// Initialize WebRTC
initSenderWebRTC({
    sendSignal: signaling.sendSignal,
    onConnectionStateChange: (state) => {
        if (state === 'connected') {
            setConnectedState(true);
            info.textContent = 'Connected to receiver!';
        } else if (state === 'disconnected' || state === 'failed') {
            info.textContent = 'Receiver disconnected. Waiting...';
        }
    }
});

// Initialize echo cancellation
initEchoCancellation({
    getAudioContext,
    getMusicPlaying: isMusicPlaying,
    getMusicAudio: () => musicAudio,
    getLocalStream
});

// Initialize music player
initMusicPlayer(
    {
        musicAudio,
        musicIndicator: musicStatusBar,
        musicTrackName,
        musicTimerEl,
        musicControlsPanel,
        musicBtn,
        musicPlaylistSelect,
        musicTimerSelect,
        musicResetBtn,
        musicVolumeSlider,
        musicVolumeValue,
        musicLabel
    },
    {
        onMusicStatusBroadcast: (status) => {
            if (signaling.isConnected()) {
                signaling.sendSignal({
                    type: 'music-status',
                    ...status
                });
            }
        },
        onEchoCancelSetup: async () => {
            if (isEchoCancelEnabled() && getAudioContext() && getLocalStream()) {
                if (setupEchoCancellation()) {
                    await replaceAudioTrack(getProcessedAudioTrack());
                    broadcastEchoCancelStatus();
                }
            }
        },
        onEchoCancelTeardown: async () => {
            if (isEchoCancelActive()) {
                teardownEchoCancellation();
                if (getOriginalAudioTrack()) {
                    await replaceAudioTrack(getOriginalAudioTrack());
                }
                broadcastEchoCancelStatus();
            }
        }
    }
);

function broadcastEchoCancelStatus() {
    if (!signaling.isConnected()) return;

    signaling.sendSignal({
        type: 'echo-cancel-status',
        enabled: isEchoCancelEnabled(),
        active: isEchoCancelActive()
    });
}

async function handleEchoCancelToggle(enabled) {
    console.log('Echo cancel toggle:', enabled);
    setEchoCancelEnabled(enabled);

    if (enabled && isMusicPlaying()) {
        if (setupEchoCancellation()) {
            await replaceAudioTrack(getProcessedAudioTrack());
        }
    } else {
        teardownEchoCancellation();
        if (getOriginalAudioTrack()) {
            await replaceAudioTrack(getOriginalAudioTrack());
        }
    }

    broadcastEchoCancelStatus();
}

// Message handler
async function handleMessage(message) {
    switch (message.type) {
        case 'registered':
            console.log('Registered as sender, isStreaming:', isStreaming);
            signaling.setConnected(true);
            info.textContent = 'Connected to server. Auto-starting stream...';
            if (!isStreaming) {
                console.log('Scheduling auto-start in 500ms');
                setTimeout(() => {
                    console.log('Auto-start triggered, calling startStreamingHandler');
                    startStreamingHandler();
                }, 500);
            } else {
                console.log('Already streaming, skipping auto-start');
            }
            setTimeout(() => {
                broadcastMusicStatus();
                broadcastEchoCancelStatus();
            }, 1000);
            break;

        case 'error':
            alert(message.message);
            window.location.href = '/';
            break;

        case 'replaced':
            console.log('Replaced by another sender');
            signaling.setConnected(false);
            info.textContent = 'Another device took over as sender. Refresh to reclaim.';
            setDisconnectedState();
            break;

        case 'request-offer':
            console.log('Receiver requesting offer, videoEnabled:', message.videoEnabled);
            if (message.videoEnabled !== undefined) {
                setReceiverWantsVideo(message.videoEnabled);
                updateStreamingStatus();
            }
            if (getLocalStream()) {
                await createOffer(pttAudio);
                broadcastMusicStatus();
            } else {
                console.log('No local stream yet');
            }
            break;

        case 'video-request':
            console.log('Receiver video request:', message.enabled);
            setReceiverWantsVideo(message.enabled);
            updateStreamingStatus();
            if (getLocalStream()) {
                await createOffer(pttAudio);
            }
            break;

        case 'answer':
            console.log('Received answer');
            await handleAnswer(message.answer);
            break;

        case 'ice-candidate':
            if (message.candidate) {
                await handleIceCandidate(message.candidate);
            }
            break;

        case 'no-receivers':
            info.textContent = 'No receivers connected. Waiting...';
            break;

        case 'ptt-start':
            console.log('Received PTT start from parent');
            setPttActive(true);
            showPTTIndicator(pttStatus);
            // Try to play PTT audio (it should have srcObject set from connection)
            if (pttAudio.srcObject) {
                pttAudio.play().then(() => {
                    console.log('PTT audio started on ptt-start signal');
                }).catch(e => console.log('PTT play on start:', e.message));
            } else {
                console.log('PTT audio srcObject not yet set');
            }
            break;

        case 'ptt-offer':
            console.log('Received PTT offer from parent');
            showPTTIndicator(pttStatus);
            await handlePTTOffer(message.offer);
            break;

        case 'ptt-stop':
            console.log('Received PTT stop from parent');
            setPttActive(false);
            hidePTTIndicator(pttStatus);
            break;

        case 'music-start':
            console.log('Received music start:', message.timerMinutes, 'minutes, playlist:', message.playlist);
            if (message.playlist) {
                await switchPlaylist(message.playlist);
            }
            // Initialize Web Audio routing for music on first play
            // This ensures consistent audio quality regardless of echo cancel state
            initMusicWebAudio();
            startMusic(message.timerMinutes, isEchoCancelEnabled());
            break;

        case 'music-stop':
            console.log('Received music stop');
            fadeOutAndStop();
            break;

        case 'music-timer-reset':
            console.log('Received music timer reset:', message.timerMinutes, 'minutes');
            resetMusicTimer(message.timerMinutes);
            break;

        case 'echo-cancel-enable':
            console.log('Received echo cancel toggle:', message.enabled);
            await handleEchoCancelToggle(message.enabled);
            break;

        case 'heartbeat':
            break;
    }
}

// Start streaming handler
async function startStreamingHandler() {
    console.log('startStreamingHandler called, video:', enableVideo.checked, 'audio:', enableAudio.checked);
    try {
        console.log('Calling startStreaming...');
        await startStreaming({
            video: enableVideo.checked,
            audio: enableAudio.checked,
            quality: videoQuality,
            videoElement: localVideo
        });
        console.log('startStreaming completed');

        if (enableAudio.checked) {
            setupAudioAnalysis(getLocalStream(), audioLevel);
        }

        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        optionsPanel.style.display = 'none';
        streamingStatus.style.display = 'flex';
        isStreaming = true;
        updateStreamingStatus();

        info.textContent = 'Streaming... Waiting for receivers.';
        setConnectedState(true);

        enableAudioPlayback();

        console.log('Creating offer...');
        await createOffer(pttAudio);
        console.log('Offer created');
    } catch (err) {
        console.error('Error starting stream:', err);
        alert('Failed to access camera/microphone: ' + err.message);
    }
}

// Stop streaming handler
function stopStreamingHandler() {
    if (isEchoCancelActive()) {
        teardownEchoCancellation();
    }

    if (isMusicPlaying()) {
        fadeOutAndStop();
    }

    stopWebRTCStreaming(localVideo);

    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    optionsPanel.style.display = 'flex';
    streamingStatus.style.display = 'none';
    isStreaming = false;
    setReceiverWantsVideo(true);
    setEchoCancelEnabled(false);

    setConnectedState(false);
    info.textContent = 'Streaming stopped.';
}

// Event listeners
startBtn.addEventListener('click', startStreamingHandler);
stopBtn.addEventListener('click', stopStreamingHandler);

document.addEventListener('click', enableAudioPlayback, { passive: true });
document.addEventListener('touchstart', enableAudioPlayback, { passive: true });
document.addEventListener('touchend', enableAudioPlayback, { passive: true });

// Initialize - connect SSE immediately
signaling.connect();
enableAudioPlayback();
