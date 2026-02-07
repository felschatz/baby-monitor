/**
 * Receiver Application - Main orchestration
 * Wires together all modules for the receiver page
 */

import { initKeepAwake } from './keep-awake.js';
import { initSession } from './session.js';
import { createSignalingManager } from './signaling.js';
import {
    initAudioAnalysis,
    setupAudioAnalysis,
    ensureAudioContext,
    resetAudioAnalysis,
    setNoiseGateThreshold,
    setPlaybackVolume,
    resetNoiseGate,
    isAudioRoutedThroughWebAudio,
    getNoiseGateThreshold,
    setVideoElement,
    destroyAudioAnalysis
} from './audio-analysis.js';
import {
    initVideoPlayback,
    showPlayOverlay,
    hideOverlay,
    handleUserInteraction,
    updateAudioOnlyIndicator,
    handleVideoTrack,
    hasUserInteracted,
    getHasVideoTrack,
    setHasVideoTrack,
    getAudioOnlyMode,
    setAudioOnlyMode,
    getRemoteVideo,
    setupAudioTrackMuteDetection,
    resetMediaMutedState,
    destroyVideoPlayback
} from './video-playback.js';
import {
    initPTT,
    startPTT,
    stopPTT,
    setupPTTButton,
    cleanupPTT
} from './ptt.js';
import {
    initReceiverWebRTC,
    handleOffer,
    handleIceCandidate,
    closePeerConnection,
    getPeerConnection,
    restartIceIfNeeded,
    requestOffer,
    getPTTAudioSender
} from './receiver-webrtc.js';

import {
    destroyKeepAwake
} from './keep-awake.js';

// DOM elements
const sessionOverlay = document.getElementById('sessionOverlay');
const sessionInput = document.getElementById('sessionInput');
const sessionJoinBtn = document.getElementById('sessionJoinBtn');
const disconnectAlert = document.getElementById('disconnectAlert');
const pttBtn = document.getElementById('pttBtn');
const pttLabel = document.getElementById('pttLabel');
const remoteVideo = document.getElementById('remoteVideo');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const audioOnlyIndicator = document.getElementById('audioOnlyIndicator');
const videoContainer = document.getElementById('videoContainer');
const audioLevel = document.getElementById('audioLevel');
const volumeSlider = document.getElementById('volume');
const volumeValue = document.getElementById('volumeValue');
const sensitivitySlider = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const noiseGateSlider = document.getElementById('noiseGate');
const noiseGateValue = document.getElementById('noiseGateValue');
const noiseGateHint = document.getElementById('noiseGateHint');
const noiseGateInfoItem = document.getElementById('noiseGateInfoItem');
const noiseGateDisplay = document.getElementById('noiseGateDisplay');
const noiseGateMarker = document.getElementById('noiseGateMarker');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const info = document.getElementById('info');
const thresholdMarker = document.getElementById('thresholdMarker');
const audioOnlyToggle = document.getElementById('audioOnlyToggle');
const echoCancelToggle = document.getElementById('echoCancelToggle');
const echoCancelToggleLabel = document.getElementById('echoCancelToggleLabel');
const shutdownTimerSelect = document.getElementById('shutdownTimerSelect');
const shutdownBtn = document.getElementById('shutdownBtn');
const shutdownStatus = document.getElementById('shutdownStatus');
const shutdownInfoItem = document.getElementById('shutdownInfoItem');
const shutdownStatusDisplay = document.getElementById('shutdownStatusDisplay');
const testSoundBtn = document.getElementById('testSoundBtn');

// Music elements
const musicContainer = document.getElementById('musicContainer');
const musicBtn = document.getElementById('musicBtn');
const musicPlaylistSelect = document.getElementById('musicPlaylistSelect');
const musicTimerSelect = document.getElementById('musicTimerSelect');
const musicResetBtn = document.getElementById('musicResetBtn');
const musicStatus = document.getElementById('musicStatus');

// Drawer elements
const drawerToggle = document.getElementById('drawerToggle');
const controlsDrawer = document.getElementById('controlsDrawer');
const volumeDisplay = document.getElementById('volumeDisplay');
const sensitivityDisplay = document.getElementById('sensitivityDisplay');
const musicInfoItem = document.getElementById('musicInfoItem');
const musicStatusDisplay = document.getElementById('musicStatusDisplay');

// Audio meter row elements
const audioLevelInline = document.getElementById('audioLevelInline');
const thresholdMarkerInline = document.getElementById('thresholdMarkerInline');
const noiseGateMarkerInline = document.getElementById('noiseGateMarkerInline');
const audioMeterRow = document.querySelector('.audio-meter-row');

// Initialize session
const sessionName = initSession({
    pathPrefix: '/r/',
    overlay: sessionOverlay,
    input: sessionInput,
    button: sessionJoinBtn,
    redirectPrefix: '/r/'
});

if (!sessionName) {
    throw new Error('Session required');
}

// State
let isConnected = false;
let isMediaMuted = false;
let musicPlaying = false;
let currentStream = null;  // Store stream for noise gate setup
let musicAvailable = false;
let musicPlaylists = [];
let currentPlaylistId = localStorage.getItem('receiver-music-playlist') || '1';
let playlistsUnlocked = localStorage.getItem('receiver-playlists-unlocked') === 'true';
let loudSoundTimeout = null;
let loudSoundCooldown = false;
let echoCancelEnabled = localStorage.getItem('receiver-echo-cancel') === 'true';
let debugTimerMode = false; // Will be set from /api/music response
let shutdownTimerValue = parseInt(localStorage.getItem('receiver-shutdown-timer') || '6');
let testSoundResetTimer = null;
const testSoundButtonLabel = testSoundBtn ? testSoundBtn.textContent : 'Send test ping';

// Initialize keep-awake
initKeepAwake();

// Load saved settings
const savedVolume = localStorage.getItem('receiver-volume');
const savedSensitivity = localStorage.getItem('receiver-sensitivity');
const savedNoiseGate = localStorage.getItem('receiver-noise-gate');

if (savedVolume !== null) {
    volumeSlider.value = savedVolume;
    volumeValue.textContent = savedVolume + '%';
    volumeDisplay.textContent = savedVolume + '%';
}
if (savedSensitivity !== null) {
    sensitivitySlider.value = savedSensitivity;
    sensitivityValue.textContent = savedSensitivity;
    sensitivityDisplay.textContent = savedSensitivity;
}
if (savedNoiseGate !== null) {
    noiseGateSlider.value = savedNoiseGate;
    updateNoiseGateDisplay(parseInt(savedNoiseGate));
}

// Initialize audio-only toggle
audioOnlyToggle.checked = getAudioOnlyMode();
echoCancelToggle.checked = echoCancelEnabled;

// Set video element reference for noise gate
setVideoElement(remoteVideo);

// Initialize shutdown timer select
shutdownTimerSelect.value = shutdownTimerValue.toString();
updateShutdownButtonState();

// Helper functions
function setConnectedState(connected) {
    isConnected = connected;
    if (connected) {
        document.body.classList.add('connected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
        overlay.classList.add('hidden');
        disconnectAlert.classList.remove('active');
        pttBtn.disabled = false;
        sessionStorage.setItem('receiver-streaming', 'true');
        updateAudioOnlyIndicator();
    } else {
        document.body.classList.remove('connected');
        statusDot.classList.remove('connected');
        statusText.textContent = 'Waiting';
        overlay.classList.remove('hidden');
        pttBtn.disabled = true;
        stopPTT(pttBtn, pttLabel);
        audioOnlyIndicator.classList.remove('active');
    }
    updateTestSoundButton();
}

function setDisconnectedState() {
    isConnected = false;
    isMediaMuted = false;
    setHasVideoTrack(false);
    document.body.classList.remove('connected');
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected!';
    overlay.classList.remove('hidden');
    overlayText.textContent = 'Connection lost! Reconnecting...';

    document.body.classList.remove('soft-alert-active');
    document.body.classList.remove('loud-alert-active');
    disconnectAlert.classList.add('active');

    audioOnlyIndicator.classList.remove('active');
    noiseGateInfoItem.classList.remove('gating');
    resetMusicUI();
    resetTestSoundButton();
}

function resetTestSoundButton() {
    if (!testSoundBtn) return;
    if (testSoundResetTimer) {
        clearTimeout(testSoundResetTimer);
        testSoundResetTimer = null;
    }
    testSoundBtn.classList.remove('active');
    testSoundBtn.textContent = testSoundButtonLabel;
    testSoundBtn.disabled = !isConnected;
}

function updateTestSoundButton() {
    if (!testSoundBtn) return;
    testSoundBtn.disabled = !isConnected;
}

function setMediaMutedState(muted) {
    if (!isConnected) return;

    isMediaMuted = muted;

    if (muted) {
        // Show red alert - media stopped flowing (sender screen likely off)
        statusText.textContent = 'Media paused';
        overlayText.textContent = 'Sender screen off? Waiting for media...';
        overlay.classList.remove('hidden');

        document.body.classList.remove('soft-alert-active');
        document.body.classList.remove('loud-alert-active');
        disconnectAlert.classList.add('active');
    } else {
        // Media resumed - restore connected state
        statusText.textContent = 'Connected';
        overlay.classList.add('hidden');
        disconnectAlert.classList.remove('active');
    }
}

function triggerLoudSoundAlert(isSoft = false) {
    if (!isConnected || loudSoundCooldown) return;

    if (isSoft) {
        document.body.classList.add('soft-alert-active');
    } else {
        document.body.classList.add('loud-alert-active');
    }

    // Add alert state to inline meter
    if (audioMeterRow) {
        audioMeterRow.classList.add('alert');
    }

    loudSoundCooldown = true;

    clearTimeout(loudSoundTimeout);
    loudSoundTimeout = setTimeout(() => {
        document.body.classList.remove('soft-alert-active');
        document.body.classList.remove('loud-alert-active');
        if (audioMeterRow) {
            audioMeterRow.classList.remove('alert');
        }
        setTimeout(() => {
            loudSoundCooldown = false;
        }, 2000);
    }, isSoft ? 2000 : 1000);
}

function updateThresholdMarker() {
    const threshold = 100 - parseInt(sensitivitySlider.value);
    thresholdMarker.style.left = threshold + '%';
    if (thresholdMarkerInline) thresholdMarkerInline.style.left = threshold + '%';
    sensitivityValue.textContent = sensitivitySlider.value;
}

function updateNoiseGateDisplay(value) {
    // Update markers on both audio meters
    if (noiseGateMarker) noiseGateMarker.style.width = value + '%';
    if (noiseGateMarkerInline) {
        noiseGateMarkerInline.style.display = value > 0 ? 'block' : 'none';
        noiseGateMarkerInline.style.width = value + '%';
    }

    if (value === 0) {
        noiseGateValue.textContent = 'Off';
        noiseGateHint.textContent = 'Mutes audio below threshold level';
        noiseGateHint.classList.remove('active');
        noiseGateInfoItem.style.display = 'none';
    } else {
        noiseGateValue.textContent = value + '%';
        noiseGateHint.textContent = 'Audio below ' + value + '% will be muted';
        noiseGateHint.classList.add('active');
        noiseGateInfoItem.style.display = 'flex';
        noiseGateDisplay.textContent = value + '%';
    }
}

function handleGatingChange(isGating) {
    // Don't update gating indicator when disconnected
    if (!isConnected) {
        noiseGateInfoItem.classList.remove('gating');
        return;
    }
    if (isGating) {
        noiseGateInfoItem.classList.add('gating');
    } else {
        noiseGateInfoItem.classList.remove('gating');
    }
}

// Music functions
async function checkMusicAvailability() {
    try {
        const response = await fetch(`/api/music?playlist=${encodeURIComponent(currentPlaylistId)}`);
        const data = await response.json();
        const allPlaylists = data.playlists || [];
        musicPlaylists = playlistsUnlocked
            ? allPlaylists
            : allPlaylists.filter(p => !p.hidden);

        if (musicPlaylists.length > 0) {
            musicPlaylistSelect.innerHTML = '';
            musicPlaylists.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                if (p.id === currentPlaylistId) option.selected = true;
                musicPlaylistSelect.appendChild(option);
            });
            musicPlaylistSelect.style.display = 'inline-block';

            const playlistIds = musicPlaylists.map(p => p.id);
            if (!playlistIds.includes(currentPlaylistId)) {
                currentPlaylistId = musicPlaylists[0].id;
                localStorage.setItem('receiver-music-playlist', currentPlaylistId);
                musicPlaylistSelect.value = currentPlaylistId;
            }
        } else {
            musicPlaylistSelect.style.display = 'none';
        }

        if (data.debugTimer && !musicTimerSelect.querySelector('option[value="1"]')) {
            const debugOption = document.createElement('option');
            debugOption.value = '1';
            debugOption.textContent = '1 min (debug)';
            musicTimerSelect.insertBefore(debugOption, musicTimerSelect.firstChild);
        }

        // Setup shutdown timer based on debug mode
        if (data.debugTimer) {
            debugTimerMode = true;
            // Replace hours with seconds in shutdown timer for debug mode
            shutdownTimerSelect.innerHTML = `
                <option value="0">Disabled</option>
                <option value="10">10 sec</option>
                <option value="30">30 sec</option>
                <option value="60">60 sec</option>
                <option value="120">2 min</option>
            `;
            shutdownTimerSelect.value = shutdownTimerValue.toString();
        }

        if ((data.files && data.files.length > 0) || musicPlaylists.length > 0) {
            musicAvailable = true;
            musicContainer.style.display = 'block';
            console.log('Music available:', data.files?.length || 0, 'tracks in playlist', currentPlaylistId);
        } else {
            musicContainer.style.display = 'none';
            console.log('No music files available');
        }
    } catch (err) {
        console.error('Failed to check music availability:', err);
        musicContainer.style.display = 'none';
    }
}

function toggleMusic() {
    if (!musicAvailable) return;

    if (musicPlaying) {
        signaling.sendSignal({ type: 'music-stop' });
    } else {
        const timerMinutes = parseInt(musicTimerSelect.value);
        signaling.sendSignal({
            type: 'music-start',
            timerMinutes: timerMinutes,
            playlist: currentPlaylistId
        });
    }
}

function updateMusicUI() {
    if (musicPlaying) {
        musicBtn.textContent = '⏹️';
        musicBtn.classList.add('active');
        musicTimerSelect.disabled = false;
        musicResetBtn.style.display = 'inline-block';
        musicInfoItem.style.display = 'flex';
    } else {
        musicBtn.textContent = '🎵';
        musicBtn.classList.remove('active');
        musicTimerSelect.disabled = false;
        musicResetBtn.style.display = 'none';
        musicStatus.textContent = '';
        musicInfoItem.style.display = 'none';
        musicStatusDisplay.textContent = '—';
    }
}

function resetMusicUI() {
    musicPlaying = false;
    updateMusicUI();
}

function handleMusicStatus(message) {
    musicPlaying = message.playing;
    updateMusicUI();

    if (message.playing && message.currentTrack) {
        const mins = Math.floor(message.timerRemaining / 60);
        const secs = message.timerRemaining % 60;
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        musicStatus.textContent = `${message.currentTrack} • ${timeStr}`;
        musicStatusDisplay.textContent = timeStr;
    }
}

function handleEchoCancelStatus(message) {
    console.log('Echo cancel status:', message);
    if (message.active) {
        echoCancelToggleLabel.classList.add('active');
    } else {
        echoCancelToggleLabel.classList.remove('active');
    }
}

// Shutdown status functions
let shutdownActive = false;
let shutdownEndTime = null;  // Local end time for smooth countdown
let shutdownCountdownInterval = null;

function updateShutdownButtonState() {
    const label = shutdownActive ? 'Reset' : 'Set';
    shutdownBtn.textContent = label;
    shutdownBtn.title = shutdownActive
        ? 'Reset auto-shutdown countdown'
        : 'Set auto-shutdown countdown';
}

function formatShutdownTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateShutdownDisplay() {
    if (!shutdownActive || !shutdownEndTime) return;
    const remaining = Math.max(0, shutdownEndTime - Date.now());
    const timeStr = formatShutdownTime(remaining);
    shutdownStatus.textContent = timeStr + ' remaining';
    shutdownStatusDisplay.textContent = timeStr;
    if (remaining <= 0) {
        handleShutdownStatus({ active: false, remainingMs: 0 });
    }
}

function handleShutdownStatus(message) {
    shutdownActive = message.active;
    if (message.active && message.remainingMs > 0) {
        // Store end time for local countdown interpolation
        shutdownEndTime = Date.now() + message.remainingMs;
        const timeStr = formatShutdownTime(message.remainingMs);
        shutdownStatus.textContent = timeStr + ' remaining';
        shutdownStatusDisplay.textContent = timeStr;
        shutdownInfoItem.style.display = 'flex';
        shutdownBtn.classList.add('active');
        // Start local countdown interval for smooth display
        if (!shutdownCountdownInterval) {
            shutdownCountdownInterval = setInterval(updateShutdownDisplay, 1000);
        }
    } else {
        shutdownEndTime = null;
        if (shutdownCountdownInterval) {
            clearInterval(shutdownCountdownInterval);
            shutdownCountdownInterval = null;
        }
        shutdownStatus.textContent = '';
        shutdownStatusDisplay.textContent = '—';
        shutdownInfoItem.style.display = 'none';
        shutdownBtn.classList.remove('active');
    }
    updateShutdownButtonState();
}

// Create signaling manager
const signaling = createSignalingManager({
    sessionName,
    role: 'receiver',
    sseEndpoint: '/api/sse/receiver',
    onMessage: handleMessage,
    onError: () => {
        setDisconnectedState();
    }
});

// Initialize modules
initAudioAnalysis({
    onLoudSound: triggerLoudSoundAlert,
    getSensitivity: () => parseInt(sensitivitySlider.value),
    getMusicPlaying: () => musicPlaying,
    getIsConnected: () => isConnected,
    onGatingChange: handleGatingChange
});

initVideoPlayback(
    {
        remoteVideo,
        overlay,
        overlayText,
        audioOnlyIndicator,
        videoContainer
    },
    {
        onUserInteraction: () => {
            ensureAudioContext(audioLevel);
            // Set noise gate threshold from saved settings
            const savedGate = localStorage.getItem('receiver-noise-gate');
            const noiseGateValue = savedGate !== null ? parseInt(savedGate) : 0;
            setNoiseGateThreshold(noiseGateValue);
        },
        getIsConnected: () => isConnected,
        onMediaMuted: setMediaMutedState,
        isAudioRoutedThroughWebAudio
    }
);

initPTT({
    remoteVideo,
    sendSignal: signaling.sendSignal,
    getIsConnected: () => isConnected,
    getPTTAudioSender
});

initReceiverWebRTC({
    sendSignal: signaling.sendSignal,
    onConnectionStateChange: (state) => {
        if (state === 'connected') {
            setConnectedState(true);
            info.textContent = 'Streaming';
        } else if (state === 'disconnected') {
            setDisconnectedState();
            info.textContent = 'Connection lost. Reconnecting...';
            setTimeout(() => {
                restartIceIfNeeded();
            }, 2000);
        } else if (state === 'failed') {
            setDisconnectedState();
            info.textContent = 'Connection failed. Requesting new stream...';
            setTimeout(() => {
                requestOffer(!getAudioOnlyMode());
            }, 2000);
        }
    },
    onStreamStale: (isStale) => {
        // Called when no bytes received for ~5 seconds (sender screen likely off)
        setMediaMutedState(isStale);
    },
    onTrack: (event) => {
        currentStream = event.streams[0];
        remoteVideo.srcObject = currentStream;
        console.log('Set video srcObject, tracks in stream:', currentStream.getTracks().length);

        const savedVol = localStorage.getItem('receiver-volume');
        if (savedVol !== null) {
            remoteVideo.volume = parseInt(savedVol) / 100;
        }

        if (event.track.kind === 'video') {
            handleVideoTrack(event.track, savedVol);
            setConnectedState(true);
            info.textContent = 'Streaming';
            // Note: handleVideoTrack already calls play(), no need to call it again
        }

        if (event.track.kind === 'audio') {
            if (!getHasVideoTrack()) {
                setConnectedState(true);
                info.textContent = 'Streaming (audio only)';
                updateAudioOnlyIndicator();
                // For audio-only streams, we need to explicitly play the video element
                // (which acts as the audio player) since handleVideoTrack isn't called
                remoteVideo.play().then(() => {
                    console.log('Audio-only stream playing');
                    overlay.classList.add('hidden');
                }).catch(e => console.log('Audio-only play error:', e));
            }
            setupAudioAnalysis(currentStream, audioLevel, audioLevelInline);
            setupAudioTrackMuteDetection(event.track);
        }
    }
});

setupPTTButton(pttBtn, pttLabel);

// Message handler
async function handleMessage(message) {
    switch (message.type) {
        case 'registered':
            console.log('Registered as receiver');
            resetMusicUI();
            if (message.senderAvailable) {
                overlayText.textContent = 'Sender available. Requesting stream...';
                signaling.sendSignal({ type: 'request-offer', videoEnabled: !getAudioOnlyMode() });
                if (echoCancelEnabled) {
                    signaling.sendSignal({ type: 'echo-cancel-enable', enabled: true });
                }
                // Send shutdown timer setting to sender
                signaling.sendSignal({
                    type: 'shutdown-timeout',
                    value: shutdownTimerValue,
                    unit: debugTimerMode ? 'seconds' : 'hours'
                });
            } else {
                overlayText.textContent = 'Waiting for sender to start streaming...';
            }
            break;

        case 'sender-available':
            // If we were previously connected (sender refreshed), reload for clean reconnection
            // This is more reliable than trying to manually reset all state
            if (sessionStorage.getItem('receiver-streaming') === 'true') {
                console.log('Sender reconnected - reloading for clean state');
                sessionStorage.removeItem('receiver-streaming');
                window.location.reload();
                return;
            }
            // First connection - request stream normally
            overlayText.textContent = 'Sender started. Requesting stream...';
            signaling.sendSignal({ type: 'request-offer', videoEnabled: !getAudioOnlyMode() });
            if (echoCancelEnabled) {
                signaling.sendSignal({ type: 'echo-cancel-enable', enabled: true });
            }
            // Send shutdown timer setting to sender
            signaling.sendSignal({
                type: 'shutdown-timeout',
                value: shutdownTimerValue,
                unit: debugTimerMode ? 'seconds' : 'hours'
            });
            break;

        case 'sender-disconnected':
            setDisconnectedState();
            handleShutdownStatus({ active: false, remainingMs: 0 });
            closePeerConnection();
            resetAudioAnalysis();
            resetNoiseGate();
            resetMediaMutedState();
            setHasVideoTrack(false);
            updateAudioOnlyIndicator();
            // Clear video element and stream for reconnection
            currentStream = null;
            remoteVideo.srcObject = null;
            // Re-enable audio-only toggle for next connection attempt
            audioOnlyToggle.disabled = false;
            break;

        case 'offer':
            console.log('Received offer');
            await handleOffer(message.offer);
            break;

        case 'ice-candidate':
            if (message.candidate) {
                await handleIceCandidate(message.candidate);
            }
            break;

        case 'ptt-answer':
            // No longer needed - PTT uses replaceTrack instead of renegotiation
            console.log('Received ptt-answer (ignored - using replaceTrack)');
            break;

        case 'music-status':
            console.log('Received music status:', message);
            handleMusicStatus(message);
            break;

        case 'echo-cancel-status':
            console.log('Received echo cancel status:', message);
            handleEchoCancelStatus(message);
            break;

        case 'shutdown-status':
            handleShutdownStatus(message);
            break;

        case 'video-unavailable':
            console.log('Sender video is unavailable');
            // Auto-enable audio-only mode and disable toggle
            audioOnlyToggle.checked = true;
            audioOnlyToggle.disabled = true;
            setAudioOnlyMode(true);
            info.textContent = 'Sender video unavailable';
            break;

        case 'sender-ready':
            // Sender's stream is now ready - request an offer
            // This handles the case where our earlier request-offer arrived before sender was ready
            console.log('Sender ready, requesting stream');
            overlayText.textContent = 'Sender ready. Requesting stream...';
            signaling.sendSignal({ type: 'request-offer', videoEnabled: !getAudioOnlyMode() });
            if (echoCancelEnabled) {
                signaling.sendSignal({ type: 'echo-cancel-enable', enabled: true });
            }
            break;

        case 'heartbeat':
            break;
    }
}

// Event listeners
audioOnlyToggle.addEventListener('change', () => {
    setAudioOnlyMode(audioOnlyToggle.checked);
    console.log('Audio-only mode:', getAudioOnlyMode());
    signaling.sendSignal({ type: 'video-request', enabled: !getAudioOnlyMode() });
});

echoCancelToggle.addEventListener('change', () => {
    echoCancelEnabled = echoCancelToggle.checked;
    localStorage.setItem('receiver-echo-cancel', echoCancelEnabled);
    console.log('Echo cancel mode:', echoCancelEnabled);
    signaling.sendSignal({ type: 'echo-cancel-enable', enabled: echoCancelEnabled });
});

shutdownTimerSelect.addEventListener('change', () => {
    shutdownTimerValue = parseInt(shutdownTimerSelect.value);
    localStorage.setItem('receiver-shutdown-timer', shutdownTimerValue);
    console.log('Shutdown timer changed:', shutdownTimerValue, debugTimerMode ? 'seconds' : 'hours');
    updateShutdownButtonState();
});

shutdownBtn.addEventListener('click', () => {
    console.log('Setting shutdown timer to', shutdownTimerValue, debugTimerMode ? 'seconds' : 'hours');
    signaling.sendSignal({
        type: 'shutdown-timeout',
        value: shutdownTimerValue,
        unit: debugTimerMode ? 'seconds' : 'hours'
    });
});

if (testSoundBtn) {
    testSoundBtn.addEventListener('click', () => {
        if (!isConnected || testSoundBtn.disabled) return;
        console.log('Sending test sound ping');
        signaling.sendSignal({ type: 'test-sound' });
        testSoundBtn.disabled = true;
        testSoundBtn.classList.add('active');
        testSoundBtn.textContent = 'Sending...';
        if (testSoundResetTimer) {
            clearTimeout(testSoundResetTimer);
        }
        testSoundResetTimer = setTimeout(() => {
            resetTestSoundButton();
        }, 1400);
    });
}

// Shared volume update function
function updateVolume(value) {
    const numValue = parseInt(value);
    const volumeLevel = numValue / 100;
    // Always use video element volume directly (Bluetooth compatible)
    remoteVideo.volume = volumeLevel;
    remoteVideo.muted = false;
    volumeSlider.value = numValue;
    volumeValue.textContent = numValue + '%';
    volumeDisplay.textContent = numValue + '%';
    overlay.classList.add('hidden');
    localStorage.setItem('receiver-volume', numValue);
}

volumeSlider.addEventListener('input', () => updateVolume(volumeSlider.value));

sensitivitySlider.addEventListener('input', () => {
    updateThresholdMarker();
    sensitivityDisplay.textContent = sensitivitySlider.value;
    localStorage.setItem('receiver-sensitivity', sensitivitySlider.value);
});

noiseGateSlider.addEventListener('input', () => {
    const value = parseInt(noiseGateSlider.value);
    updateNoiseGateDisplay(value);
    setNoiseGateThreshold(value);
    localStorage.setItem('receiver-noise-gate', value);
});

fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.documentElement.requestFullscreen();
    }
});

musicBtn.addEventListener('click', toggleMusic);

musicResetBtn.addEventListener('click', () => {
    if (!musicPlaying) return;
    const timerMinutes = parseInt(musicTimerSelect.value);
    console.log('Resetting music timer to', timerMinutes, 'minutes');
    signaling.sendSignal({ type: 'music-timer-reset', timerMinutes: timerMinutes });
});

musicPlaylistSelect.addEventListener('change', () => {
    currentPlaylistId = musicPlaylistSelect.value;
    localStorage.setItem('receiver-music-playlist', currentPlaylistId);
    console.log('Switched to playlist:', currentPlaylistId);
});

// Long-press on playlist dropdown to unlock hidden playlists
let longPressTimer = null;
const startLongPress = () => {
    longPressTimer = setTimeout(() => {
        if (!playlistsUnlocked) {
            playlistsUnlocked = true;
            localStorage.setItem('receiver-playlists-unlocked', 'true');
            console.log('Playlists unlocked!');
            checkMusicAvailability();
        }
    }, 3000);
};
const cancelLongPress = () => {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
};
musicPlaylistSelect.addEventListener('mousedown', startLongPress);
musicPlaylistSelect.addEventListener('touchstart', startLongPress);
musicPlaylistSelect.addEventListener('mouseup', cancelLongPress);
musicPlaylistSelect.addEventListener('mouseleave', cancelLongPress);
musicPlaylistSelect.addEventListener('touchend', cancelLongPress);
musicPlaylistSelect.addEventListener('touchcancel', cancelLongPress);

// User interaction handlers for audio context and noise gate
function onUserInteractionGlobal() {
    handleUserInteraction();
    ensureAudioContext(audioLevel);
    // Set noise gate threshold from saved settings
    const savedGate = localStorage.getItem('receiver-noise-gate');
    const noiseGateValue = savedGate !== null ? parseInt(savedGate) : 0;
    setNoiseGateThreshold(noiseGateValue);
}
document.addEventListener('click', onUserInteractionGlobal, { passive: true });
document.addEventListener('touchstart', onUserInteractionGlobal, { passive: true });
document.addEventListener('keydown', () => handleUserInteraction(), { passive: true });

// Drawer toggle - position drawer above bottom bar
function updateDrawerPosition() {
    const audioMeterRowEl = document.querySelector('.audio-meter-row');
    const bottomBar = document.querySelector('.bottom-bar');
    const infoStrip = document.querySelector('.info-strip');
    // Calculate total height of audio meter row + bottom bar + info strip
    const audioMeterRowHeight = audioMeterRowEl ? audioMeterRowEl.offsetHeight : 0;
    const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;
    const infoStripHeight = infoStrip ? infoStrip.offsetHeight : 0;
    const totalBottomHeight = audioMeterRowHeight + bottomBarHeight + infoStripHeight;
    document.documentElement.style.setProperty('--drawer-anchor-bottom', `${totalBottomHeight}px`);
}

// Calculate initial position on load
updateDrawerPosition();

drawerToggle.addEventListener('click', () => {
    updateDrawerPosition();
    const isOpen = controlsDrawer.classList.toggle('open');
    drawerToggle.classList.toggle('active', isOpen);
    document.body.classList.toggle('drawer-open', isOpen);
});

// Update drawer position on resize
window.addEventListener('resize', () => {
    updateDrawerPosition();
}, { passive: true });

// Close drawer when clicking outside
document.addEventListener('click', (e) => {
    if (controlsDrawer.classList.contains('open') &&
        !controlsDrawer.contains(e.target) &&
        !drawerToggle.contains(e.target)) {
        controlsDrawer.classList.remove('open');
        drawerToggle.classList.remove('active');
        document.body.classList.remove('drawer-open');
    }
}, { passive: true });

// Page unload cleanup
window.addEventListener('beforeunload', () => {
    // Clear any pending timeouts
    if (loudSoundTimeout) {
        clearTimeout(loudSoundTimeout);
    }
    if (longPressTimer) {
        clearTimeout(longPressTimer);
    }
    if (testSoundResetTimer) {
        clearTimeout(testSoundResetTimer);
    }
    if (shutdownCountdownInterval) {
        clearInterval(shutdownCountdownInterval);
    }
    cleanupPTT();
    destroyKeepAwake();
    destroyAudioAnalysis();
    destroyVideoPlayback();
    closePeerConnection();
    signaling.disconnect();
});

// Initialize
updateThresholdMarker();
checkMusicAvailability();
signaling.connect();
