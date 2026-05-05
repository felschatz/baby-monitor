/**
 * Receiver Application - Main orchestration
 * Wires together all modules for the receiver page
 */

import { initKeepAwake } from './keep-awake.js';
import { initSession } from './session.js';
import { createSignalingManager } from './signaling.js';
import { loadRtcConfig } from './webrtc.js';
import {
    initAudioAnalysis,
    setupAudioAnalysis,
    ensureAudioContext,
    resetAudioAnalysis,
    getAudioContext,
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
const lockBtn = document.getElementById('lockBtn');
const lockBtnText = document.getElementById('lockBtnText');
const reloadBtn = document.getElementById('reloadBtn');
const info = document.getElementById('info');
const thresholdMarker = document.getElementById('thresholdMarker');
const audioOnlyToggle = document.getElementById('audioOnlyToggle');
const echoCancelToggle = document.getElementById('echoCancelToggle');
const echoCancelToggleLabel = document.getElementById('echoCancelToggleLabel');
const sensitivityAlertToggle = document.getElementById('sensitivityAlertToggle');
const monitorNoiseToggle = document.getElementById('monitorNoiseToggle');
const monitorNoiseVolumeContainer = document.getElementById('monitorNoiseVolumeContainer');
const monitorNoiseVolumeSlider = document.getElementById('monitorNoiseVolume');
const monitorNoiseVolumeValue = document.getElementById('monitorNoiseVolumeValue');
const shutdownTimerSelect = document.getElementById('shutdownTimerSelect');
const shutdownBtn = document.getElementById('shutdownBtn');
const shutdownStatus = document.getElementById('shutdownStatus');
const shutdownInfoItem = document.getElementById('shutdownInfoItem');
const shutdownStatusDisplay = document.getElementById('shutdownStatusDisplay');
const testSoundBtn = document.getElementById('testSoundBtn');
let debugBanner = document.getElementById('debugBanner');
let debugText = document.getElementById('debugText');
let debugToggleBtn = document.getElementById('debugToggleBtn');

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
const monitorNoiseInfoItem = document.getElementById('monitorNoiseInfoItem');
const monitorNoiseStatusDisplay = document.getElementById('monitorNoiseStatusDisplay');

// Audio meter row elements
const audioLevelInline = document.getElementById('audioLevelInline');
const thresholdMarkerInline = document.getElementById('thresholdMarkerInline');
const noiseGateMarkerInline = document.getElementById('noiseGateMarkerInline');
const audioMeterRow = document.querySelector('.audio-meter-row');

let transportMode = new URLSearchParams(window.location.search).get('transport') === 'relay'
    ? 'relay'
    : 'direct';
let sessionTransportMode = null;
let loadedTransportMode = null;
const DEFAULT_MONITOR_NOISE_VOLUME = 35;

// Initialize session
const sessionName = initSession({
    pathPrefix: '/r/',
    overlay: sessionOverlay,
    input: sessionInput,
    button: sessionJoinBtn,
    redirectPrefix: '/r/',
    queryString: ''
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
let sensitivityAlertEnabled = localStorage.getItem('receiver-sensitivity-alert-sound') !== 'false';
let monitorNoiseEnabled = localStorage.getItem('receiver-monitor-noise') === 'true';
let debugTimerMode = false; // Will be set from /api/music response
const DEFAULT_SHUTDOWN_SELECTION = '6h';
let shutdownTimerValue = localStorage.getItem('receiver-shutdown-timer') || DEFAULT_SHUTDOWN_SELECTION;
let testSoundResetTimer = null;
const testSoundButtonLabel = testSoundBtn ? testSoundBtn.textContent : 'Send test ping';
let shutdownActive = false;
let shutdownEndTime = null;  // Local end time for smooth countdown
let shutdownCountdownInterval = null;
let debugInterval = null;
const DEBUG_MINIMIZED_STORAGE_KEY = 'receiver-debug-minimized';
let debugMinimized = localStorage.getItem(DEBUG_MINIMIZED_STORAGE_KEY) === 'true';
let uiLocked = false;
let unlockHoldTimer = null;
const UNLOCK_HOLD_MS = 1000;
const CONNECTION_LOST_SOUND_DELAY_MS = 5000;
const connectionLostAudio = new Audio('/connection_lost.mp3');
connectionLostAudio.preload = 'auto';
let connectionLostSoundStartTimer = null;
let connectionLostSoundLoopTimer = null;
let monitorNoiseVolume = DEFAULT_MONITOR_NOISE_VOLUME;

function playSensitivityAlertSound() {
    if (!sensitivityAlertEnabled || !isConnected) return;
    signaling.sendSignal({ type: 'sensitivity-sound' });
    // Mobile networks can briefly flap SSE while POST still works; send one delayed retry.
    setTimeout(() => {
        if (sensitivityAlertEnabled && isConnected) {
            signaling.sendSignal({ type: 'sensitivity-sound' });
        }
    }, 180);
}

// Initialize keep-awake
initKeepAwake();

function stopConnectionLostSound() {
    if (connectionLostSoundStartTimer) {
        clearTimeout(connectionLostSoundStartTimer);
        connectionLostSoundStartTimer = null;
    }
    if (connectionLostSoundLoopTimer) {
        clearInterval(connectionLostSoundLoopTimer);
        connectionLostSoundLoopTimer = null;
    }
    connectionLostAudio.pause();
    connectionLostAudio.currentTime = 0;
}

function playConnectionLostSound() {
    if (isConnected) return;
    try {
        connectionLostAudio.pause();
        connectionLostAudio.currentTime = 0;
    } catch (err) {
        console.log('Could not reset connection lost sound:', err);
    }
    connectionLostAudio.play().catch(err => {
        console.log('Connection lost sound play failed:', err);
    });
}

function startConnectionLostSoundLoop() {
    if (isConnected || connectionLostSoundStartTimer || connectionLostSoundLoopTimer) return;

    connectionLostSoundStartTimer = setTimeout(() => {
        connectionLostSoundStartTimer = null;
        if (isConnected) return;

        playConnectionLostSound();
        connectionLostSoundLoopTimer = setInterval(() => {
            if (isConnected) {
                stopConnectionLostSound();
                return;
            }
            playConnectionLostSound();
        }, CONNECTION_LOST_SOUND_DELAY_MS);
    }, CONNECTION_LOST_SOUND_DELAY_MS);
}

function clampMonitorNoiseVolume(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_MONITOR_NOISE_VOLUME;
    }
    return Math.min(100, Math.max(0, parsed));
}

function updateMonitorNoiseVolumeUi(value) {
    monitorNoiseVolume = clampMonitorNoiseVolume(value);
    if (monitorNoiseVolumeSlider) {
        monitorNoiseVolumeSlider.value = monitorNoiseVolume;
    }
    if (monitorNoiseVolumeValue) {
        monitorNoiseVolumeValue.textContent = monitorNoiseVolume + '%';
    }
}

function syncMonitorNoiseUi() {
    if (monitorNoiseToggle) {
        monitorNoiseToggle.checked = monitorNoiseEnabled;
    }
    if (monitorNoiseVolumeContainer) {
        monitorNoiseVolumeContainer.style.display = monitorNoiseEnabled ? 'block' : 'none';
    }
    if (monitorNoiseInfoItem) {
        monitorNoiseInfoItem.style.display = monitorNoiseEnabled ? 'flex' : 'none';
    }
    if (monitorNoiseStatusDisplay) {
        monitorNoiseStatusDisplay.textContent = monitorNoiseEnabled
            ? `Tone ${monitorNoiseVolume}%`
            : 'Off';
    }
}

function sendMonitorNoiseState() {
    if (!isConnected) {
        return;
    }
    signaling.sendSignal({
        type: 'monitor-noise',
        enabled: monitorNoiseEnabled,
        volume: monitorNoiseVolume
    });
}

function ensureDebugBanner() {
    if (!debugBanner) {
        const banner = document.createElement('div');
        banner.className = 'debug-banner';
        banner.id = 'debugBanner';
        banner.style.display = 'none';
        banner.innerHTML = `
            <div class="debug-header">
                <div class="debug-title">Debug</div>
                <button type="button" class="debug-toggle-btn" id="debugToggleBtn" aria-controls="debugText" aria-expanded="true">Minimize</button>
            </div>
            <div class="debug-text" id="debugText"></div>
        `;

        const headerEl = document.querySelector('.header');
        if (headerEl && headerEl.parentNode) {
            headerEl.parentNode.insertBefore(banner, headerEl);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }

        debugBanner = banner;
    }

    // Upgrade old markup so the panel can be collapsed and reopened.
    if (debugBanner && !debugBanner.querySelector('#debugToggleBtn')) {
        debugBanner.innerHTML = `
            <div class="debug-header">
                <div class="debug-title">Debug</div>
                <button type="button" class="debug-toggle-btn" id="debugToggleBtn" aria-controls="debugText" aria-expanded="true">Minimize</button>
            </div>
            <div class="debug-text" id="debugText"></div>
        `;
    }

    debugText = debugBanner ? debugBanner.querySelector('#debugText') : null;
    debugToggleBtn = debugBanner ? debugBanner.querySelector('#debugToggleBtn') : null;
}

function setDebugMinimized(minimized) {
    debugMinimized = !!minimized;

    if (debugBanner) {
        debugBanner.classList.toggle('minimized', debugMinimized);
    }

    if (debugToggleBtn) {
        debugToggleBtn.textContent = debugMinimized ? 'Open' : 'Minimize';
        debugToggleBtn.setAttribute('aria-expanded', debugMinimized ? 'false' : 'true');
        debugToggleBtn.setAttribute('aria-label', debugMinimized ? 'Open debug panel' : 'Minimize debug panel');
    }

    localStorage.setItem(DEBUG_MINIMIZED_STORAGE_KEY, String(debugMinimized));
}

function setupDebugControls() {
    if (!debugToggleBtn) return;

    debugToggleBtn.addEventListener('click', () => {
        setDebugMinimized(!debugMinimized);
    });

    setDebugMinimized(debugMinimized);
}

ensureDebugBanner();
setupDebugControls();

const debugParams = new URLSearchParams(window.location.search);
let debugEnabled = debugParams.get('debug') === '1' || debugParams.get('debug') === 'true';

// Load saved settings
const savedVolume = localStorage.getItem('receiver-volume');
const savedSensitivity = localStorage.getItem('receiver-sensitivity');
const savedNoiseGate = localStorage.getItem('receiver-noise-gate');
const savedMonitorNoiseVolume = localStorage.getItem('receiver-monitor-noise-volume');

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
if (savedMonitorNoiseVolume !== null) {
    updateMonitorNoiseVolumeUi(savedMonitorNoiseVolume);
} else {
    updateMonitorNoiseVolumeUi(DEFAULT_MONITOR_NOISE_VOLUME);
}

// Initialize audio-only toggle
audioOnlyToggle.checked = getAudioOnlyMode();
echoCancelToggle.checked = echoCancelEnabled;
if (sensitivityAlertToggle) {
    sensitivityAlertToggle.checked = sensitivityAlertEnabled;
}
syncMonitorNoiseUi();

// Set video element reference for noise gate
setVideoElement(remoteVideo);

const shutdownTimerOptions = {
    standard: [
        { value: 'off', label: 'Disabled' },
        { value: '20m', label: '20 min' },
        { value: '4h', label: '4 hours' },
        { value: '6h', label: '6 hours' },
        { value: '8h', label: '8 hours' },
        { value: '10h', label: '10 hours' },
        { value: 'now', label: 'Shutdown now' }
    ],
    debug: [
        { value: 'off', label: 'Disabled' },
        { value: '10s', label: '10 sec' },
        { value: '30s', label: '30 sec' },
        { value: '5m', label: '5 min' },
        { value: '20m', label: '20 min' },
        { value: '1h', label: '1 hour' },
        { value: 'now', label: 'Shutdown now' }
    ]
};

function renderShutdownOptions(options) {
    shutdownTimerSelect.innerHTML = options
        .map(option => `<option value="${option.value}">${option.label}</option>`)
        .join('');
}

function normalizeShutdownTimerValue(value) {
    if (!value) return DEFAULT_SHUTDOWN_SELECTION;
    if (value === 'off' || value === 'now') return value;
    if (/^\d+(?:\.\d+)?[hms]$/.test(value)) return value;
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        return `${value}${debugTimerMode ? 's' : 'h'}`;
    }
    return DEFAULT_SHUTDOWN_SELECTION;
}

function applyShutdownSelection() {
    shutdownTimerValue = normalizeShutdownTimerValue(shutdownTimerValue);
    if (!shutdownTimerSelect.querySelector(`option[value="${shutdownTimerValue}"]`)) {
        const fallback = shutdownTimerSelect.querySelector(`option[value="${DEFAULT_SHUTDOWN_SELECTION}"]`)
            ? DEFAULT_SHUTDOWN_SELECTION
            : shutdownTimerSelect.options[0]?.value || DEFAULT_SHUTDOWN_SELECTION;
        shutdownTimerValue = fallback;
    }
    shutdownTimerSelect.value = shutdownTimerValue;
    localStorage.setItem('receiver-shutdown-timer', shutdownTimerValue);
}

function parseShutdownSelection(value) {
    if (value === 'now') return { mode: 'now' };
    if (value === 'off' || value === '0') {
        return { mode: 'disabled', value: 0, unit: debugTimerMode ? 'seconds' : 'hours' };
    }
    const match = value.match(/^(\d+(?:\.\d+)?)([hms])$/);
    if (match) {
        const unitMap = { h: 'hours', m: 'minutes', s: 'seconds' };
        return {
            mode: 'timeout',
            value: parseFloat(match[1]),
            unit: unitMap[match[2]]
        };
    }
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        return {
            mode: 'timeout',
            value: parseFloat(value),
            unit: debugTimerMode ? 'seconds' : 'hours'
        };
    }
    return { mode: 'disabled', value: 0, unit: debugTimerMode ? 'seconds' : 'hours' };
}

// Initialize shutdown timer select
renderShutdownOptions(shutdownTimerOptions.standard);
applyShutdownSelection();
updateShutdownButtonState();

// Helper functions
function setConnectedState(connected) {
    isConnected = connected;
    if (connected) {
        stopConnectionLostSound();
        document.body.classList.add('connected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
        overlay.classList.add('hidden');
        disconnectAlert.classList.remove('active');
        pttBtn.disabled = false;
        sessionStorage.setItem('receiver-streaming', 'true');
        updateAudioOnlyIndicator();
        sendMonitorNoiseState();
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
    startConnectionLostSoundLoop();
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

function closeControlsDrawer() {
    controlsDrawer.classList.remove('open');
    drawerToggle.classList.remove('active');
    document.body.classList.remove('drawer-open');
}

async function enterFullscreenIfPossible() {
    if (document.fullscreenElement) return true;
    if (!document.documentElement.requestFullscreen) return false;

    try {
        await document.documentElement.requestFullscreen();
        return true;
    } catch (err) {
        console.log('Fullscreen request failed:', err);
        return false;
    }
}

async function exitFullscreenIfActive() {
    if (!document.fullscreenElement || !document.exitFullscreen) return false;

    try {
        await document.exitFullscreen();
        return true;
    } catch (err) {
        console.log('Exit fullscreen failed:', err);
        return false;
    }
}

function setUiLocked(locked) {
    uiLocked = !!locked;
    document.body.classList.toggle('ui-locked', uiLocked);
    lockBtn.classList.toggle('locked', uiLocked);
    lockBtn.setAttribute('aria-pressed', uiLocked ? 'true' : 'false');
    lockBtn.setAttribute('aria-label', uiLocked ? 'Hold to unlock controls' : 'Lock controls');
    lockBtn.title = uiLocked ? 'Hold to unlock controls' : 'Lock controls';
    if (lockBtnText) {
        lockBtnText.textContent = uiLocked ? 'Hold to unlock' : 'Lock';
    }

    if (uiLocked) {
        closeControlsDrawer();
    } else {
        cancelUnlockHold();
    }
}

function cancelUnlockHold() {
    if (unlockHoldTimer) {
        clearTimeout(unlockHoldTimer);
        unlockHoldTimer = null;
    }

    if (lockBtn) {
        lockBtn.classList.remove('holding');
    }
    if (lockBtnText && uiLocked) {
        lockBtnText.textContent = 'Hold to unlock';
    }
}

function startUnlockHold(event) {
    if (!uiLocked || unlockHoldTimer) return;

    event.preventDefault();
    lockBtn.classList.add('holding');
    if (lockBtnText) {
        lockBtnText.textContent = 'Keep holding...';
    }

    unlockHoldTimer = setTimeout(() => {
        cancelUnlockHold();
        setUiLocked(false);
        exitFullscreenIfActive();
    }, UNLOCK_HOLD_MS);
}

async function lockInterface() {
    await enterFullscreenIfPossible();
    setUiLocked(true);
}

function handleTestSoundStatus(message) {
    if (!testSoundBtn) return;
    if (testSoundResetTimer) {
        clearTimeout(testSoundResetTimer);
        testSoundResetTimer = null;
    }

    let label = testSoundButtonLabel;
    switch (message.status) {
        case 'received':
            label = 'Sender received';
            break;
        case 'playing':
            label = 'Playing ping';
            break;
        case 'complete':
            label = 'Ping sent';
            break;
        case 'ignored':
            if (message.detail === 'no-stream') {
                label = 'Sender idle';
            } else if (message.detail === 'no-audio-track') {
                label = 'Audio off';
            } else {
                label = 'Ignored';
            }
            break;
        case 'failed':
            label = 'Ping failed';
            break;
        case 'busy':
            label = 'Sender busy';
            break;
        default:
            label = 'Ping status';
            break;
    }

    testSoundBtn.disabled = true;
    testSoundBtn.classList.add('active');
    testSoundBtn.textContent = label;
    testSoundResetTimer = setTimeout(() => {
        resetTestSoundButton();
    }, 1800);
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

    playSensitivityAlertSound();

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
        debugTimerMode = !!data.debugTimer;
        renderShutdownOptions(debugTimerMode ? shutdownTimerOptions.debug : shutdownTimerOptions.standard);
        applyShutdownSelection();
        setDebugEnabled(debugEnabled || debugTimerMode);

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

function setDebugEnabled(enabled) {
    debugEnabled = !!enabled;
    if (debugBanner) {
        debugBanner.style.display = debugEnabled ? 'block' : 'none';
    }
    if (debugEnabled) {
        updateDebugBanner();
        if (!debugInterval) {
            debugInterval = setInterval(updateDebugBanner, 1000);
        }
    } else if (debugInterval) {
        clearInterval(debugInterval);
        debugInterval = null;
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
    transportMode,
    onMessage: handleMessage,
    onError: () => {
        setDisconnectedState();
    }
});

function setSignalingTransportMode(mode) {
    transportMode = mode === 'relay' ? 'relay' : 'direct';
    signaling.setTransportMode(transportMode);
}

async function ensureTransportMode(mode) {
    const nextTransportMode = mode === 'relay' ? 'relay' : 'direct';
    setSignalingTransportMode(nextTransportMode);

    if (loadedTransportMode === nextTransportMode) {
        return true;
    }

    try {
        await loadRtcConfig(nextTransportMode);
        loadedTransportMode = nextTransportMode;
        return true;
    } catch (err) {
        console.error('Failed to initialize WebRTC transport:', err);
        setDisconnectedState();
        overlayText.textContent = err.message || 'Failed to initialize relay mode.';
        info.textContent = err.message || 'Failed to initialize relay mode.';
        pttBtn.disabled = true;
        return false;
    }
}

async function requestStreamFromSender(statusText, advertisedTransportMode = null) {
    const nextTransportMode = advertisedTransportMode === 'relay'
        ? 'relay'
        : (advertisedTransportMode === 'direct'
            ? 'direct'
            : (sessionTransportMode || transportMode));

    sessionTransportMode = nextTransportMode;

    const ready = await ensureTransportMode(nextTransportMode);
    if (!ready) {
        return;
    }

    if (statusText) {
        overlayText.textContent = statusText;
    }

    requestOffer(!getAudioOnlyMode());
    if (echoCancelEnabled) {
        signaling.sendSignal({ type: 'echo-cancel-enable', enabled: true });
    }
}

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
                requestStreamFromSender('Connection failed. Requesting new stream...', sessionTransportMode);
            }, 2000);
        }
    },
    onStreamStale: (isStale) => {
        // Called when no bytes received for ~5 seconds (sender screen likely off)
        setMediaMutedState(isStale);
    },
    onTrack: (event) => {
        const incomingStream = event.streams && event.streams[0] ? event.streams[0] : null;

        if (!currentStream) {
            currentStream = incomingStream || new MediaStream();
        }

        if (incomingStream && incomingStream !== currentStream) {
            incomingStream.getTracks().forEach(track => {
                const hasTrack = currentStream.getTracks().some(existingTrack => existingTrack.id === track.id);
                if (!hasTrack) {
                    currentStream.addTrack(track);
                }
            });
        }

        const streamHasTrack = currentStream.getTracks().some(track => track.id === event.track.id);
        if (!streamHasTrack) {
            currentStream.addTrack(event.track);
        }

        remoteVideo.srcObject = currentStream;
        console.log(
            'Set video srcObject, tracks in stream:',
            currentStream.getTracks().length,
            'provided streams:',
            event.streams ? event.streams.length : 0
        );

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
                // For audio-only streams, explicitly start the <video> element as audio player.
                // First attempt unmuted playback; if autoplay blocks it, keep stream alive muted
                // and prompt the user to tap for sound.
                remoteVideo.muted = false;
                remoteVideo.play().then(() => {
                    console.log('Audio-only stream playing');
                    overlay.classList.add('hidden');
                }).catch(err => {
                    console.log('Audio-only play with sound failed, retrying muted:', err);
                    remoteVideo.muted = true;
                    remoteVideo.play().then(() => {
                        console.log('Audio-only stream playing muted; waiting for user tap to enable sound');
                        showPlayOverlay('Tap to enable sound');
                    }).catch(err2 => {
                        console.log('Audio-only muted play error:', err2);
                        showPlayOverlay('Tap to play');
                    });
                });
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
            sessionTransportMode = message.transportMode === 'relay'
                ? 'relay'
                : (message.transportMode === 'direct' ? 'direct' : null);
            if (message.senderAvailable) {
                await requestStreamFromSender('Sender available. Requesting stream...', sessionTransportMode);
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
            sessionTransportMode = message.transportMode === 'relay' ? 'relay' : 'direct';
            // First connection - request stream normally
            await requestStreamFromSender('Sender started. Requesting stream...', sessionTransportMode);
            break;

        case 'sender-disconnected':
            sessionTransportMode = null;
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
            await handleOffer(message.offer, message.pttMid);
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
            sessionTransportMode = message.transportMode === 'relay'
                ? 'relay'
                : (message.transportMode === 'direct' ? 'direct' : sessionTransportMode);
            await requestStreamFromSender('Sender ready. Requesting stream...', sessionTransportMode);
            break;

        case 'test-sound-status':
            console.log('Test sound status:', message.status, message.detail || '');
            handleTestSoundStatus(message);
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

if (sensitivityAlertToggle) {
    sensitivityAlertToggle.addEventListener('change', () => {
        sensitivityAlertEnabled = sensitivityAlertToggle.checked;
        localStorage.setItem('receiver-sensitivity-alert-sound', sensitivityAlertEnabled);
        console.log('Sensitivity alert sound:', sensitivityAlertEnabled ? 'enabled' : 'disabled');
    });
}

if (monitorNoiseToggle) {
    monitorNoiseToggle.addEventListener('change', () => {
        monitorNoiseEnabled = monitorNoiseToggle.checked;
        localStorage.setItem('receiver-monitor-noise', monitorNoiseEnabled);
        syncMonitorNoiseUi();
        sendMonitorNoiseState();
        console.log('Monitor tone:', monitorNoiseEnabled ? 'enabled' : 'disabled');
    });
}

if (monitorNoiseVolumeSlider) {
    monitorNoiseVolumeSlider.addEventListener('input', () => {
        updateMonitorNoiseVolumeUi(monitorNoiseVolumeSlider.value);
        localStorage.setItem('receiver-monitor-noise-volume', monitorNoiseVolume);
        syncMonitorNoiseUi();
        sendMonitorNoiseState();
    });
}

shutdownTimerSelect.addEventListener('change', () => {
    shutdownTimerValue = shutdownTimerSelect.value;
    localStorage.setItem('receiver-shutdown-timer', shutdownTimerValue);
    const selection = parseShutdownSelection(shutdownTimerValue);
    if (selection.mode === 'now') {
        console.log('Shutdown timer changed: now');
    } else if (selection.mode === 'disabled') {
        console.log('Shutdown timer changed: disabled');
    } else {
        console.log('Shutdown timer changed:', selection.value, selection.unit);
    }
    updateShutdownButtonState();
});

shutdownBtn.addEventListener('click', () => {
    const selection = parseShutdownSelection(shutdownTimerSelect.value);
    if (selection.mode === 'now') {
        console.log('Shutdown now requested');
        signaling.sendSignal({ type: 'shutdown-now' });
        return;
    }
    console.log('Setting shutdown timer to', selection.value, selection.unit);
    signaling.sendSignal({
        type: 'shutdown-timeout',
        value: selection.value,
        unit: selection.unit
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

if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
        window.location.reload();
    });
}

lockBtn.addEventListener('click', () => {
    if (uiLocked) return;
    lockInterface();
});
setUiLocked(false);

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

if (lockBtn) {
    lockBtn.addEventListener('mousedown', startUnlockHold);
    lockBtn.addEventListener('touchstart', startUnlockHold, { passive: false });
    lockBtn.addEventListener('mouseup', cancelUnlockHold);
    lockBtn.addEventListener('mouseleave', cancelUnlockHold);
    lockBtn.addEventListener('touchend', cancelUnlockHold);
    lockBtn.addEventListener('touchcancel', cancelUnlockHold);
    document.addEventListener('mouseup', cancelUnlockHold);
    document.addEventListener('touchend', cancelUnlockHold, { passive: true });
    document.addEventListener('touchcancel', cancelUnlockHold, { passive: true });
}

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
    if (uiLocked) return;
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
        closeControlsDrawer();
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
    if (debugInterval) {
        clearInterval(debugInterval);
    }
    stopConnectionLostSound();
    cleanupPTT();
    destroyKeepAwake();
    destroyAudioAnalysis();
    destroyVideoPlayback();
    closePeerConnection();
    signaling.disconnect();
});

window.addEventListener('pageshow', () => {
    if (!uiLocked) {
        setUiLocked(false);
    }
});

function formatTrackState(track) {
    if (!track) return 'none';
    const muted = track.muted ? 'muted' : 'unmuted';
    return `${track.readyState}, ${muted}`;
}

function updateDebugBanner() {
    if (!debugEnabled || !debugText) return;

    const stream = remoteVideo?.srcObject || null;
    const audioTracks = stream ? stream.getAudioTracks() : [];
    const videoTracks = stream ? stream.getVideoTracks() : [];
    const audioTrack = audioTracks[0] || null;
    const videoTrack = videoTracks[0] || null;
    const ctx = getAudioContext();
    const volume = typeof remoteVideo?.volume === 'number' ? remoteVideo.volume.toFixed(2) : 'n/a';
    const muted = remoteVideo ? remoteVideo.muted : 'n/a';
    const paused = remoteVideo ? remoteVideo.paused : 'n/a';
    const overlayState = overlay?.classList.contains('hidden') ? 'hidden' : 'shown';

    const lines = [
        `connected: ${isConnected}`,
        `stream: ${stream ? 'yes' : 'no'} active=${stream ? stream.active : 'n/a'}`,
        `audioTrack: ${audioTracks.length} (${formatTrackState(audioTrack)})`,
        `videoTrack: ${videoTracks.length} (${formatTrackState(videoTrack)})`,
        `video: muted=${muted} vol=${volume} paused=${paused}`,
        `audioOnlyMode: ${getAudioOnlyMode()} hasVideoTrack: ${getHasVideoTrack()}`,
        `overlay: ${overlayState}`,
        `audioCtx: ${ctx ? ctx.state : 'none'}`
    ];

    debugText.innerHTML = lines.map(line => `<div>${line}</div>`).join('');
}

// Initialize
updateThresholdMarker();
checkMusicAvailability();
setDebugEnabled(debugEnabled);

async function initializeApp() {
    startConnectionLostSoundLoop();
    signaling.connect();
}

initializeApp();
