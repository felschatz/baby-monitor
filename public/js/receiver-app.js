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
    resetAudioAnalysis
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
    getRemoteVideo
} from './video-playback.js';
import {
    initPTT,
    setPeerConnection,
    startPTT,
    stopPTT,
    handlePTTAnswer,
    setupPTTButton
} from './ptt.js';
import {
    initReceiverWebRTC,
    handleOffer,
    handleIceCandidate,
    closePeerConnection,
    getPeerConnection,
    restartIceIfNeeded,
    requestOffer
} from './receiver-webrtc.js';

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
const fullscreenBtn = document.getElementById('fullscreenBtn');
const info = document.getElementById('info');
const thresholdMarker = document.getElementById('thresholdMarker');
const audioOnlyToggle = document.getElementById('audioOnlyToggle');
const echoCancelToggle = document.getElementById('echoCancelToggle');
const echoCancelToggleLabel = document.getElementById('echoCancelToggleLabel');

// Music elements
const musicContainer = document.getElementById('musicContainer');
const musicBtn = document.getElementById('musicBtn');
const musicPlaylistSelect = document.getElementById('musicPlaylistSelect');
const musicTimerSelect = document.getElementById('musicTimerSelect');
const musicResetBtn = document.getElementById('musicResetBtn');
const musicLabel = document.getElementById('musicLabel');
const musicStatus = document.getElementById('musicStatus');

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
let musicPlaying = false;
let musicAvailable = false;
let musicPlaylists = [];
let currentPlaylistId = localStorage.getItem('receiver-music-playlist') || '1';
let loudSoundTimeout = null;
let loudSoundCooldown = false;
let echoCancelEnabled = localStorage.getItem('receiver-echo-cancel') === 'true';

// Initialize keep-awake
initKeepAwake();

// Load saved settings
const savedVolume = localStorage.getItem('receiver-volume');
const savedSensitivity = localStorage.getItem('receiver-sensitivity');

if (savedVolume !== null) {
    volumeSlider.value = savedVolume;
    volumeValue.textContent = savedVolume + '%';
}
if (savedSensitivity !== null) {
    sensitivitySlider.value = savedSensitivity;
    sensitivityValue.textContent = savedSensitivity;
}

// Initialize audio-only toggle
audioOnlyToggle.checked = getAudioOnlyMode();
echoCancelToggle.checked = echoCancelEnabled;

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
}

function setDisconnectedState() {
    isConnected = false;
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
    resetMusicUI();
}

function triggerLoudSoundAlert(isSoft = false) {
    if (!isConnected || loudSoundCooldown) return;

    if (isSoft) {
        document.body.classList.add('soft-alert-active');
    } else {
        document.body.classList.add('loud-alert-active');
    }

    loudSoundCooldown = true;

    clearTimeout(loudSoundTimeout);
    loudSoundTimeout = setTimeout(() => {
        document.body.classList.remove('soft-alert-active');
        document.body.classList.remove('loud-alert-active');
        setTimeout(() => {
            loudSoundCooldown = false;
        }, 2000);
    }, isSoft ? 2000 : 1000);
}

function updateThresholdMarker() {
    const threshold = 100 - parseInt(sensitivitySlider.value);
    thresholdMarker.style.left = threshold + '%';
    sensitivityValue.textContent = sensitivitySlider.value;
}

// Music functions
async function checkMusicAvailability() {
    try {
        const response = await fetch(`/api/music?playlist=${encodeURIComponent(currentPlaylistId)}`);
        const data = await response.json();
        musicPlaylists = data.playlists || [];

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
        musicLabel.textContent = 'Stop music';
        musicTimerSelect.disabled = false;
        musicResetBtn.style.display = 'inline-block';
    } else {
        musicBtn.textContent = '🎵';
        musicBtn.classList.remove('active');
        musicLabel.textContent = 'Play lullabies';
        musicTimerSelect.disabled = false;
        musicResetBtn.style.display = 'none';
        musicStatus.textContent = '';
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
        musicStatus.textContent = `♪ ${message.currentTrack} • ${mins}:${secs.toString().padStart(2, '0')}`;
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
    getIsConnected: () => isConnected
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
        },
        getIsConnected: () => isConnected
    }
);

initPTT({
    remoteVideo,
    sendSignal: signaling.sendSignal,
    getIsConnected: () => isConnected
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
    onTrack: (event) => {
        remoteVideo.srcObject = event.streams[0];
        console.log('Set video srcObject, tracks in stream:', event.streams[0].getTracks().length);

        const savedVol = localStorage.getItem('receiver-volume');
        if (savedVol !== null) {
            remoteVideo.volume = parseInt(savedVol) / 100;
        }

        if (event.track.kind === 'video') {
            handleVideoTrack(event.track, savedVol);
            setConnectedState(true);
            info.textContent = 'Streaming';

            // Unmute based on user interaction
            remoteVideo.muted = !hasUserInteracted();
            remoteVideo.play().catch(e => {
                console.log('Play on ICE connect:', e);
                showPlayOverlay();
            });
        }

        if (event.track.kind === 'audio') {
            if (!getHasVideoTrack()) {
                setConnectedState(true);
                info.textContent = 'Streaming (audio only)';
                updateAudioOnlyIndicator();
            }
            setupAudioAnalysis(event.streams[0], audioLevel);
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
            } else {
                overlayText.textContent = 'Waiting for sender to start streaming...';
            }
            break;

        case 'sender-available':
            overlayText.textContent = 'Sender started. Requesting stream...';
            signaling.sendSignal({ type: 'request-offer', videoEnabled: !getAudioOnlyMode() });
            if (echoCancelEnabled) {
                signaling.sendSignal({ type: 'echo-cancel-enable', enabled: true });
            }
            break;

        case 'sender-disconnected':
            setDisconnectedState();
            closePeerConnection();
            resetAudioAnalysis();
            setHasVideoTrack(false);
            updateAudioOnlyIndicator();
            break;

        case 'offer':
            console.log('Received offer');
            await handleOffer(message.offer);
            setPeerConnection(getPeerConnection());
            break;

        case 'ice-candidate':
            if (message.candidate) {
                await handleIceCandidate(message.candidate);
            }
            break;

        case 'ptt-answer':
            await handlePTTAnswer(message.answer);
            break;

        case 'music-status':
            console.log('Received music status:', message);
            handleMusicStatus(message);
            break;

        case 'echo-cancel-status':
            console.log('Received echo cancel status:', message);
            handleEchoCancelStatus(message);
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

volumeSlider.addEventListener('input', () => {
    const value = volumeSlider.value / 100;
    remoteVideo.volume = value;
    remoteVideo.muted = false;
    volumeValue.textContent = volumeSlider.value + '%';
    overlay.classList.add('hidden');
    localStorage.setItem('receiver-volume', volumeSlider.value);
});

sensitivitySlider.addEventListener('input', () => {
    updateThresholdMarker();
    localStorage.setItem('receiver-sensitivity', sensitivitySlider.value);
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

// User interaction handlers for audio context
document.addEventListener('click', () => {
    handleUserInteraction();
    ensureAudioContext(audioLevel);
}, { passive: true });
document.addEventListener('touchstart', () => {
    handleUserInteraction();
    ensureAudioContext(audioLevel);
}, { passive: true });
document.addEventListener('keydown', () => handleUserInteraction(), { passive: true });

// Initialize
updateThresholdMarker();
checkMusicAvailability();
signaling.connect();
