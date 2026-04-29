/**
 * Sender Application - Main orchestration
 * Wires together all modules for the sender page
 */

import { initKeepAwake, startAutoShutdown, cancelAutoShutdown, destroyKeepAwake, setAutoShutdownTime, setShutdownStatusCallback, getAutoShutdownRemaining } from './keep-awake.js';
import { initSession } from './session.js';
import { createSignalingManager } from './signaling.js';
import { loadRtcConfig } from './webrtc.js';
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
    applyMicGainIfReady,
    showPTTIndicator,
    hidePTTIndicator,
    getLocalStream,
    getAudioContext,
    setReceiverWantsVideo,
    getReceiverWantsVideo,
    setPttActive,
    isVideoAvailable,
    setVideoAvailable
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
const musicLabel = document.getElementById('musicLabel');

// Shutdown elements
const shutdownStatusBar = document.getElementById('shutdownStatusBar');
const shutdownTimeRemaining = document.getElementById('shutdownTimeRemaining');

// Enhanced volume slider elements
const volumeSliderContainer = document.getElementById('volumeSliderContainer');
const volumeTrackFill = document.getElementById('volumeTrackFill');
const volumeTooltip = document.getElementById('volumeTooltip');
const volumeMinusBtn = document.getElementById('volumeMinus');
const volumePlusBtn = document.getElementById('volumePlus');

// Extract quality and stream mode from URL
const urlParams = new URLSearchParams(window.location.search);
const videoQuality = urlParams.get('q') === 'sd' ? 'sd' : 'hd';
const streamMode = (urlParams.get('mode') || '').toLowerCase();
const transportMode = (urlParams.get('transport') || '').toLowerCase() === 'relay' ? 'relay' : 'direct';

const senderQueryParts = [`q=${videoQuality}`];
if (streamMode === 'audio' || streamMode === 'audio-only') {
    senderQueryParts.push('mode=audio');
}
if (transportMode === 'relay') {
    senderQueryParts.push('transport=relay');
}

// Initialize session
const sessionName = initSession({
    pathPrefix: '/s/',
    overlay: sessionOverlay,
    input: sessionInput,
    button: sessionJoinBtn,
    redirectPrefix: '/s/',
    queryString: senderQueryParts.join('&')
});

// Stop execution if no session (user needs to enter session first)
if (!sessionName) {
    throw new Error('Session required');
}

// Display quality badge
qualityBadge.textContent = videoQuality.toUpperCase();
qualityBadge.classList.add(videoQuality);

// Apply stream mode default from URL (audio-only vs audio+video)
if (streamMode === 'audio' || streamMode === 'audio-only') {
    enableVideo.checked = false;
}

// State
let isStreaming = false;
let audioEnabled = false;
let shutdownUnit = 'hours'; // Will be updated by receiver
let shutdownConfigured = false;
let testSoundInProgress = false;
let testSoundBuffer = null;
let sensitivitySoundBuffer = null;
let monitorNoiseBuffer = null;
let testSoundContext = null;
let reclaimTimer = null;
let reclaimPending = false;
let reclaimAttempts = 0;
const RECLAIM_DELAY_MS = 2000;
const DEFAULT_MONITOR_NOISE_VOLUME = 35;
const MAX_MONITOR_NOISE_GAIN = 0.35;
let monitorNoiseEnabled = false;
let monitorNoiseVolume = DEFAULT_MONITOR_NOISE_VOLUME;
let monitorNoiseSource = null;
let monitorNoiseGainNode = null;
let monitorNoiseDestination = null;
let monitorNoiseInputSource = null;
let monitorNoiseMixedTrack = null;
let monitorNoiseBaseTrackId = null;

async function registerSenderOfflineSupport() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        await navigator.serviceWorker.register('/js/sender-offline-sw.js', { scope: '/' });
        console.log('Sender offline music cache ready');
    } catch (err) {
        console.log('Could not register sender offline cache:', err.message || err);
    }
}

// Initialize keep-awake (auto-shutdown will be configured by receiver)
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

function setReconnectingState() {
    document.body.classList.remove('connected', 'disconnected');
    statusDot.classList.remove('connected');
    statusText.textContent = 'Reconnecting...';
}

function clampMonitorNoiseVolume(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_MONITOR_NOISE_VOLUME;
    }
    return Math.min(100, Math.max(0, parsed));
}

function getMonitorNoiseGain(volumePercent) {
    return (clampMonitorNoiseVolume(volumePercent) / 100) * MAX_MONITOR_NOISE_GAIN;
}

function cleanupMonitorNoiseMix() {
    if (monitorNoiseSource) {
        try {
            monitorNoiseSource.stop();
        } catch (e) {}
        try {
            monitorNoiseSource.disconnect();
        } catch (e) {}
    }
    if (monitorNoiseGainNode) {
        try {
            monitorNoiseGainNode.disconnect();
        } catch (e) {}
    }
    if (monitorNoiseInputSource) {
        try {
            monitorNoiseInputSource.disconnect();
        } catch (e) {}
    }
    if (monitorNoiseDestination) {
        try {
            monitorNoiseDestination.disconnect();
        } catch (e) {}
    }
    if (monitorNoiseMixedTrack) {
        try {
            monitorNoiseMixedTrack.stop();
        } catch (e) {}
    }

    monitorNoiseSource = null;
    monitorNoiseGainNode = null;
    monitorNoiseDestination = null;
    monitorNoiseInputSource = null;
    monitorNoiseMixedTrack = null;
    monitorNoiseBaseTrackId = null;
}

function formatShutdownTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateShutdownUI(status) {
    if (status.active && status.remainingMs > 0) {
        shutdownStatusBar.classList.add('active');
        shutdownTimeRemaining.textContent = 'Shutdown in ' + formatShutdownTime(status.remainingMs);
        // Urgent mode in last 60 seconds
        if (status.remainingMs <= 60000) {
            shutdownStatusBar.classList.add('urgent');
        } else {
            shutdownStatusBar.classList.remove('urgent');
        }
    } else {
        shutdownStatusBar.classList.remove('active', 'urgent');
    }
}

// Register shutdown status callback - broadcasts to receivers every 5 seconds
let lastShutdownBroadcast = 0;
let lastShutdownActive = false;
let lastShutdownRemaining = 0;
setShutdownStatusCallback((status) => {
    updateShutdownUI(status);
    // Broadcast to receivers every 5 seconds (or on state/timer change)
    const now = Date.now();
    // Detect timer reset: remaining time increased (timer was restarted)
    const timerReset = status.active && status.remainingMs > lastShutdownRemaining + 1000;
    // Detect state change: active/inactive transition
    const stateChanged = status.active !== lastShutdownActive;
    // Update tracking vars
    lastShutdownActive = status.active;
    lastShutdownRemaining = status.remainingMs;
    // Broadcast immediately on state change, timer reset, or every 5 seconds
    if (stateChanged || timerReset || now - lastShutdownBroadcast >= 5000) {
        lastShutdownBroadcast = now;
        if (signaling.isConnected()) {
            signaling.sendSignal({
                type: 'shutdown-status',
                active: status.active,
                remainingMs: status.remainingMs
            });
        }
    }
});

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

function enableAudioPlayback(fromUserGesture = false) {
    if (!audioEnabled) {
        audioEnabled = true;
        console.log('Audio playback enabled');

        const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
        silentAudio.play().catch(() => {});
    }

    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(async () => {
            if (!isEchoCancelActive()) {
                await applyMicGainIfReady();
            }
            await syncPreferredOutboundTrack();
        }).catch(() => {});
    } else {
        Promise.resolve().then(async () => {
            if (!isEchoCancelActive()) {
                await applyMicGainIfReady();
            }
            await syncPreferredOutboundTrack();
        }).catch(() => {});
    }

    if (fromUserGesture) {
        if (!testSoundContext || testSoundContext.state === 'closed') {
            testSoundContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (testSoundContext.state === 'suspended') {
            testSoundContext.resume().catch(() => {});
        }
    }

    if (pttAudio.srcObject) {
        pttAudio.play().catch(e => console.log('PTT play after enable:', e));
    }
}

function clearReclaimTimer() {
    if (reclaimTimer) {
        clearTimeout(reclaimTimer);
        reclaimTimer = null;
    }
}

async function attemptReclaim() {
    if (!reclaimPending || signaling.isConnected()) return;
    reclaimAttempts += 1;
    let senderActive = false;
    try {
        const response = await fetch(`/api/status/${encodeURIComponent(sessionName)}`);
        if (response.ok) {
            const status = await response.json();
            senderActive = status.senderActive;
        }
    } catch (err) {
        console.log('Reclaim status check failed:', err.message || err);
    }

    if (senderActive) {
        console.log('Reclaim waiting - another sender still active (attempt', reclaimAttempts, ')');
        scheduleReclaim();
        return;
    }

    console.log('Attempting to reclaim sender role (attempt', reclaimAttempts, ')');
    signaling.connect();
    scheduleReclaim();
}

function scheduleReclaim() {
    if (!reclaimPending) return;
    clearReclaimTimer();
    reclaimTimer = setTimeout(() => {
        attemptReclaim();
    }, RECLAIM_DELAY_MS);
}

function getBaseOutboundAudioTrack() {
    const localStream = getLocalStream();
    const localTrack = localStream ? localStream.getAudioTracks()[0] : null;

    if (isEchoCancelActive()) {
        return getProcessedAudioTrack() || localTrack;
    }

    return localTrack || getOriginalAudioTrack();
}

async function ensureMonitorNoiseBuffer(ctx) {
    if (monitorNoiseBuffer) return monitorNoiseBuffer;
    const response = await fetch('/noise.mp3');
    if (!response.ok) {
        throw new Error(`Failed to load noise.mp3: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    monitorNoiseBuffer = await ctx.decodeAudioData(arrayBuffer);
    return monitorNoiseBuffer;
}

async function getPreferredOutboundAudioTrack() {
    const baseTrack = getBaseOutboundAudioTrack();
    if (!monitorNoiseEnabled || !isStreaming || !baseTrack) {
        cleanupMonitorNoiseMix();
        return baseTrack;
    }

    let ctx = getAudioContext();
    if (!ctx || ctx.state === 'closed') {
        if (!testSoundContext || testSoundContext.state === 'closed') {
            testSoundContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        ctx = testSoundContext;
    }

    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (err) {
            console.log('Monitor noise: audio context resume blocked');
        }
    }

    if (monitorNoiseMixedTrack && monitorNoiseBaseTrackId === baseTrack.id) {
        if (monitorNoiseGainNode) {
            monitorNoiseGainNode.gain.value = getMonitorNoiseGain(monitorNoiseVolume);
        }
        return monitorNoiseMixedTrack;
    }

    cleanupMonitorNoiseMix();

    const buffer = await ensureMonitorNoiseBuffer(ctx);
    monitorNoiseInputSource = ctx.createMediaStreamSource(new MediaStream([baseTrack]));
    monitorNoiseGainNode = ctx.createGain();
    monitorNoiseGainNode.gain.value = getMonitorNoiseGain(monitorNoiseVolume);
    monitorNoiseDestination = ctx.createMediaStreamDestination();
    monitorNoiseSource = ctx.createBufferSource();
    monitorNoiseSource.buffer = buffer;
    monitorNoiseSource.loop = true;

    monitorNoiseInputSource.connect(monitorNoiseDestination);
    monitorNoiseSource.connect(monitorNoiseGainNode);
    monitorNoiseGainNode.connect(monitorNoiseDestination);
    monitorNoiseSource.start(0);

    monitorNoiseMixedTrack = monitorNoiseDestination.stream.getAudioTracks()[0] || null;
    monitorNoiseBaseTrackId = baseTrack.id;

    return monitorNoiseMixedTrack || baseTrack;
}

async function syncPreferredOutboundTrack() {
    if (testSoundInProgress) {
        return;
    }

    const preferredTrack = await getPreferredOutboundAudioTrack();
    if (preferredTrack) {
        await replaceAudioTrack(preferredTrack);
    }
}

function getOutboundAudioTrackForRestore() {
    return getPreferredOutboundAudioTrack();
}

async function ensureTestSoundBuffer(ctx) {
    if (testSoundBuffer) return testSoundBuffer;
    const response = await fetch('/ping.mp3');
    if (!response.ok) {
        throw new Error(`Failed to load ping.mp3: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    testSoundBuffer = await ctx.decodeAudioData(arrayBuffer);
    return testSoundBuffer;
}

async function ensureSensitivitySoundBuffer(ctx) {
    if (sensitivitySoundBuffer) return sensitivitySoundBuffer;
    const response = await fetch('/sensitivity.mp3');
    if (!response.ok) {
        throw new Error(`Failed to load sensitivity.mp3: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    sensitivitySoundBuffer = await ctx.decodeAudioData(arrayBuffer);
    return sensitivitySoundBuffer;
}

async function playTestSound(receiverId) {
    const sendTestSoundStatus = (status, detail) => {
        if (!signaling.isConnected()) return;
        signaling.sendSignal({
            type: 'test-sound-status',
            receiverId,
            status,
            detail
        });
    };

    if (testSoundInProgress) {
        console.log('Test sound already in progress');
        sendTestSoundStatus('busy');
        return;
    }
    if (!isStreaming || !getLocalStream()) {
        console.log('Test sound ignored: no active stream');
        sendTestSoundStatus('ignored', 'no-stream');
        return;
    }

    const restoreTrack = await getOutboundAudioTrackForRestore();
    if (!restoreTrack) {
        console.log('Test sound ignored: no outbound audio track');
        sendTestSoundStatus('ignored', 'no-audio-track');
        return;
    }

    testSoundInProgress = true;
    let source = null;
    let testTrack = null;

    try {
        sendTestSoundStatus('received');
        let ctx = testSoundContext;
        if (!ctx || ctx.state === 'closed') {
            ctx = getAudioContext();
        }
        if (!ctx || ctx.state === 'closed') {
            testSoundContext = new (window.AudioContext || window.webkitAudioContext)();
            ctx = testSoundContext;
        }

        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (err) {
                console.log('Test sound: audio context resume blocked');
            }
        }

        const buffer = await ensureTestSoundBuffer(ctx);
        const destination = ctx.createMediaStreamDestination();
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);

        testTrack = destination.stream.getAudioTracks()[0];
        sendTestSoundStatus('playing');
        await replaceAudioTrack(testTrack);

        await new Promise(resolve => {
            source.onended = resolve;
            source.start(0);
        });

        testTrack.stop();
        await replaceAudioTrack(restoreTrack);
        console.log('Test sound complete');
        sendTestSoundStatus('complete');
    } catch (err) {
        console.error('Test sound failed:', err);
        sendTestSoundStatus('failed', err.message);
        try {
            const fallbackTrack = await getPreferredOutboundAudioTrack();
            if (fallbackTrack) {
                await replaceAudioTrack(fallbackTrack);
            }
        } catch (restoreErr) {
            console.error('Failed to restore audio track after test sound:', restoreErr);
        }
    } finally {
        if (source) {
            try {
                source.disconnect();
            } catch (e) {}
        }
        testSoundInProgress = false;
    }
}

async function playSensitivitySound(receiverId) {
    if (testSoundInProgress) {
        console.log('Sensitivity sound ignored: audio injection busy');
        return;
    }
    if (!isStreaming || !getLocalStream()) {
        console.log('Sensitivity sound ignored: no active stream');
        return;
    }

    const restoreTrack = await getOutboundAudioTrackForRestore();
    if (!restoreTrack) {
        console.log('Sensitivity sound ignored: no outbound audio track');
        return;
    }

    testSoundInProgress = true;
    let source = null;
    let testTrack = null;

    try {
        let ctx = testSoundContext;
        if (!ctx || ctx.state === 'closed') {
            ctx = getAudioContext();
        }
        if (!ctx || ctx.state === 'closed') {
            testSoundContext = new (window.AudioContext || window.webkitAudioContext)();
            ctx = testSoundContext;
        }

        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (err) {
                console.log('Sensitivity sound: audio context resume blocked');
            }
        }

        const buffer = await ensureSensitivitySoundBuffer(ctx);
        const destination = ctx.createMediaStreamDestination();
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);

        testTrack = destination.stream.getAudioTracks()[0];
        await replaceAudioTrack(testTrack);

        await new Promise(resolve => {
            source.onended = resolve;
            source.start(0);
        });

        testTrack.stop();
        await replaceAudioTrack(restoreTrack);
        console.log('Sensitivity sound complete (receiverId:', receiverId || 'unknown', ')');
    } catch (err) {
        console.error('Sensitivity sound failed:', err);
        try {
            const fallbackTrack = await getPreferredOutboundAudioTrack();
            if (fallbackTrack) {
                await replaceAudioTrack(fallbackTrack);
            }
        } catch (restoreErr) {
            console.error('Failed to restore audio track after sensitivity sound:', restoreErr);
        }
    } finally {
        if (source) {
            try {
                source.disconnect();
            } catch (e) {}
        }
        testSoundInProgress = false;
    }
}

// Create signaling manager
const signaling = createSignalingManager({
    sessionName,
    role: 'sender',
    sseEndpoint: '/api/sse/sender',
    transportMode,
    onMessage: handleMessage,
    onError: () => {
        if (isStreaming) {
            setReconnectingState();
            info.textContent = 'Lost server connection. Reconnecting...';
            return;
        }
        setDisconnectedState();
    }
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
        musicLabel,
        // Enhanced volume slider elements
        volumeSliderContainer,
        volumeTrackFill,
        volumeTooltip,
        volumeMinusBtn,
        volumePlusBtn
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
                if (isEchoCancelActive()) {
                    broadcastEchoCancelStatus();
                    return;
                }
                if (setupEchoCancellation()) {
                    await syncPreferredOutboundTrack();
                    broadcastEchoCancelStatus();
                }
            }
        },
        onEchoCancelTeardown: async () => {
            if (isEchoCancelActive()) {
                teardownEchoCancellation();
                await applyMicGainIfReady();
                await syncPreferredOutboundTrack();
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
        if (isEchoCancelActive()) {
            broadcastEchoCancelStatus();
            return;
        }
        if (setupEchoCancellation()) {
            await syncPreferredOutboundTrack();
        }
    } else {
        teardownEchoCancellation();
        await applyMicGainIfReady();
        await syncPreferredOutboundTrack();
    }

    broadcastEchoCancelStatus();
}

// Message handler
async function handleMessage(message) {
    switch (message.type) {
        case 'registered':
            console.log('Registered as sender, isStreaming:', isStreaming);
            signaling.setConnected(true);
            if (isStreaming) {
                setConnectedState(true);
                info.textContent = 'Streaming... Waiting for receivers.';
            } else {
                info.textContent = 'Connected to server. Auto-starting stream...';
            }
            if (!isStreaming) {
                console.log('Scheduling auto-start in 500ms');
                setTimeout(() => {
                    console.log('Auto-start triggered, calling startStreamingHandler');
                    startStreamingHandler();
                }, 500);
            } else {
                console.log('Already streaming, skipping auto-start');
            }
            if (reclaimPending && isStreaming) {
                console.log('Reclaim successful - continuing stream');
                clearReclaimTimer();
                reclaimPending = false;
                reclaimAttempts = 0;
                setConnectedState(true);
                info.textContent = 'Reclaimed sender role. Continuing stream...';
                const localStream = getLocalStream();
                const hasLiveTrack = localStream && localStream.getTracks().some(track => track.readyState === 'live');
                if (!localStream || !hasLiveTrack) {
                    console.log('No live local stream after reclaim - restarting stream');
                    setTimeout(() => {
                        if (!isStreaming) return;
                        startStreamingHandler();
                    }, 100);
                }
                setTimeout(() => {
                    if (signaling.isConnected()) {
                        signaling.sendSignal({ type: 'sender-ready' });
                    }
                }, 250);
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
            setDisconnectedState();
            if (isStreaming) {
                reclaimPending = true;
                reclaimAttempts = 0;
                clearReclaimTimer();
                info.textContent = 'Another device took over. Reclaiming in 2 seconds...';
                signaling.disconnect();
                scheduleReclaim();
            } else {
                info.textContent = 'Another device took over as sender. Refresh to reclaim.';
            }
            break;

        case 'request-offer':
            console.log('Receiver requesting offer, receiverId:', message.receiverId, 'videoEnabled:', message.videoEnabled);
            if (message.videoEnabled !== undefined && message.receiverId) {
                setReceiverWantsVideo(message.videoEnabled, message.receiverId);
                updateStreamingStatus();
            }
            if (getLocalStream() && message.receiverId) {
                // If receiver wants video but video is unavailable, notify them
                if (message.videoEnabled && !isVideoAvailable()) {
                    signaling.sendSignal({ type: 'video-unavailable', receiverId: message.receiverId });
                }
                await createOffer(pttAudio, message.receiverId);
                broadcastMusicStatus();
            } else if (!message.receiverId) {
                console.log('No receiverId in request-offer, ignoring');
            } else {
                console.log('No local stream yet');
            }
            break;

        case 'video-request':
            console.log('Receiver video request:', message.enabled, 'receiverId:', message.receiverId);
            if (message.receiverId) {
                setReceiverWantsVideo(message.enabled, message.receiverId);
                updateStreamingStatus();
                if (getLocalStream()) {
                    // If receiver wants video but video is unavailable, notify them
                    if (message.enabled && !isVideoAvailable()) {
                        signaling.sendSignal({ type: 'video-unavailable', receiverId: message.receiverId });
                    }
                    await createOffer(pttAudio, message.receiverId);
                }
            }
            break;

        case 'answer':
            console.log('Received answer from receiverId:', message.receiverId);
            if (message.receiverId) {
                await handleAnswer(message.answer, message.receiverId);
            } else {
                console.log('No receiverId in answer, ignoring');
            }
            break;

        case 'ice-candidate':
            if (message.candidate && message.receiverId) {
                await handleIceCandidate(message.candidate, message.receiverId);
            }
            break;

        case 'no-receivers':
            info.textContent = 'No receivers connected. Waiting...';
            break;

        case 'ptt-start':
            console.log('Received PTT start from receiver:', message.receiverId, 'bluetoothMode:', message.bluetoothMode);
            setPttActive(true, message.receiverId);
            showPTTIndicator(pttStatus, message.receiverId, message.bluetoothMode);
            // Try to play PTT audio (it should have srcObject set from connection)
            // In Bluetooth mode, no audio will be received (mic not acquired)
            if (pttAudio.srcObject && !message.bluetoothMode) {
                pttAudio.play().then(() => {
                    console.log('PTT audio started on ptt-start signal');
                }).catch(e => console.log('PTT play on start:', e.message));
            } else if (message.bluetoothMode) {
                console.log('PTT in Bluetooth mode - no audio expected (visual alert only)');
            } else {
                console.log('PTT audio srcObject not yet set');
            }
            break;

        case 'ptt-offer':
            console.log('Received PTT offer from receiver:', message.receiverId);
            showPTTIndicator(pttStatus, message.receiverId);
            if (message.receiverId) {
                await handlePTTOffer(message.offer, message.receiverId);
            }
            break;

        case 'ptt-stop':
            console.log('Received PTT stop from receiver:', message.receiverId);
            setPttActive(false, message.receiverId);
            hidePTTIndicator(pttStatus, message.receiverId);
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

        case 'test-sound':
            console.log('Received test sound request');
            await playTestSound(message.receiverId);
            break;

        case 'sensitivity-sound':
            console.log('Received sensitivity sound request');
            await playSensitivitySound(message.receiverId);
            break;

        case 'monitor-noise':
            monitorNoiseEnabled = !!message.enabled;
            monitorNoiseVolume = clampMonitorNoiseVolume(message.volume);
            console.log('Received monitor noise config:', monitorNoiseEnabled, monitorNoiseVolume + '%');
            await syncPreferredOutboundTrack();
            break;

        case 'shutdown-timeout':
            console.log('Received shutdown timeout:', message.value, message.unit);
            shutdownUnit = message.unit || 'hours';
            const timeoutValue = Number(message.value);
            const safeValue = Number.isFinite(timeoutValue) ? timeoutValue : 0;
            setAutoShutdownTime(safeValue, shutdownUnit);
            shutdownConfigured = safeValue > 0;
            // Restart the timer if streaming
            if (isStreaming) {
                startAutoShutdown(() => {
                    console.log('Auto-shutdown triggered by receiver setting');
                    stopStreamingHandler();
                    info.textContent = 'Auto-shutdown complete. Redirecting...';
                    setTimeout(() => { window.location.href = '/'; }, 3000);
                });
            }
            break;

        case 'shutdown-now':
            console.log('Received shutdown-now from receiver');
            shutdownUnit = 'seconds';
            shutdownConfigured = false;
            setAutoShutdownTime(30, 'seconds');
            if (isStreaming) {
                startAutoShutdown(() => {
                    console.log('Immediate shutdown triggered by receiver');
                    stopStreamingHandler();
                    info.textContent = 'Shut down by receiver. Redirecting...';
                    setTimeout(() => { window.location.href = '/'; }, 3000);
                });
            }
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
        const { stream, videoFailed } = await startStreaming({
            video: enableVideo.checked,
            audio: enableAudio.checked,
            quality: videoQuality,
            videoElement: localVideo
        });
        console.log('startStreaming completed, videoFailed:', videoFailed);

        // If video failed, update the checkbox and notify receivers
        if (videoFailed) {
            console.log('Video capture failed, switching to audio-only mode');
            enableVideo.checked = false;
            enableVideo.disabled = true;
            info.textContent = 'Video unavailable - streaming audio only';
            // Notify receivers that video is unavailable
            if (signaling.isConnected()) {
                signaling.sendSignal({ type: 'video-unavailable' });
            }
        }

        if (enableAudio.checked) {
            setupAudioAnalysis(getLocalStream(), audioLevel);
        }

        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        optionsPanel.style.display = 'none';
        streamingStatus.style.display = 'flex';
        isStreaming = true;
        updateStreamingStatus();

        if (!videoFailed) {
            info.textContent = 'Streaming... Waiting for receivers.';
        }
        setConnectedState(true);

        enableAudioPlayback();
        await syncPreferredOutboundTrack();

        // Start auto-shutdown timer to save battery after long periods
        startAutoShutdown(() => {
            console.log('Auto-shutdown: stopping stream to save battery');
            stopStreamingHandler();
            info.textContent = 'Auto-shutdown complete. Redirecting...';
            setTimeout(() => { window.location.href = '/'; }, 3000);
        });

        // Notify receivers that we're ready - they may have sent request-offer
        // before our stream was ready, so tell them to request again
        console.log('Stream ready, notifying receivers');
        signaling.sendSignal({ type: 'sender-ready' });
    } catch (err) {
        console.error('Error starting stream:', err);
        alert('Failed to access camera/microphone: ' + err.message);
    }
}

// Stop streaming handler
function stopStreamingHandler() {
    // Cancel auto-shutdown timer and notify receivers
    cancelAutoShutdown();
    updateShutdownUI({ active: false, remainingMs: 0 });
    reclaimPending = false;
    clearReclaimTimer();
    reclaimAttempts = 0;
    if (signaling.isConnected()) {
        signaling.sendSignal({ type: 'shutdown-status', active: false, remainingMs: 0 });
    }

    if (isEchoCancelActive()) {
        teardownEchoCancellation();
    }

    if (isMusicPlaying()) {
        fadeOutAndStop();
    }

    cleanupMonitorNoiseMix();

    stopWebRTCStreaming(localVideo);

    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    optionsPanel.style.display = 'flex';
    streamingStatus.style.display = 'none';
    isStreaming = false;
    setReceiverWantsVideo(true);
    setEchoCancelEnabled(false);

    // Re-enable video checkbox for next stream attempt
    enableVideo.disabled = false;
    enableVideo.checked = true;

    setConnectedState(false);
    info.textContent = 'Streaming stopped.';

    // Release keep-awake resources so phone can sleep
    destroyKeepAwake();
}

// Event listeners
startBtn.addEventListener('click', startStreamingHandler);
stopBtn.addEventListener('click', stopStreamingHandler);

document.addEventListener('click', () => enableAudioPlayback(true), { passive: true });
document.addEventListener('touchstart', () => enableAudioPlayback(true), { passive: true });
document.addEventListener('touchend', () => enableAudioPlayback(true), { passive: true });

// Initialize - connect SSE immediately
async function initializeApp() {
    await registerSenderOfflineSupport();

    try {
        await loadRtcConfig(transportMode);
    } catch (err) {
        console.error('Failed to initialize WebRTC transport:', err);
        setDisconnectedState();
        startBtn.disabled = true;
        stopBtn.disabled = true;
        enableVideo.disabled = true;
        enableAudio.disabled = true;
        info.textContent = err.message || 'Failed to initialize relay mode.';
        return;
    }

    signaling.connect();
    enableAudioPlayback();
}

initializeApp();
