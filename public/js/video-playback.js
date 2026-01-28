/**
 * Video Playback handling for receiver
 * Autoplay handling, track monitoring, overlay management
 */

// State
let userHasInteracted = false;
let hasVideoTrack = false;
let audioOnlyMode = localStorage.getItem('receiver-audio-only') === 'true';

// DOM elements
let remoteVideo = null;
let overlay = null;
let overlayText = null;
let audioOnlyIndicator = null;
let videoContainer = null;

// Callbacks
let onUserInteraction = null;
let getIsConnected = null;

/**
 * Initialize video playback module
 * @param {object} elements
 * @param {object} callbacks
 */
export function initVideoPlayback(elements, callbacks) {
    remoteVideo = elements.remoteVideo;
    overlay = elements.overlay;
    overlayText = elements.overlayText;
    audioOnlyIndicator = elements.audioOnlyIndicator;
    videoContainer = elements.videoContainer;

    onUserInteraction = callbacks.onUserInteraction;
    getIsConnected = callbacks.getIsConnected;

    // Debug video events
    remoteVideo.addEventListener('loadeddata', () => {
        console.log('Video loadeddata - dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
    });

    remoteVideo.addEventListener('playing', () => {
        console.log('Video is now playing');
    });

    remoteVideo.addEventListener('waiting', () => {
        console.log('Video is waiting for data');
    });

    remoteVideo.addEventListener('stalled', () => {
        console.log('Video stalled');
    });

    remoteVideo.addEventListener('loadedmetadata', tryPlayVideo);

    // Handle overlay click
    overlay.addEventListener('click', () => {
        handleUserInteraction();
        if (remoteVideo.srcObject) {
            remoteVideo.muted = false;
            remoteVideo.play().then(() => {
                overlay.classList.add('hidden');
            }).catch(e => console.log('Overlay play error:', e));
        }
    });
}

/**
 * Show play overlay
 */
export function showPlayOverlay(message) {
    overlayText.textContent = message || 'Tap to play';
    overlay.classList.remove('hidden');
    console.log('Showing overlay:', message);
}

/**
 * Hide overlay
 */
export function hideOverlay() {
    overlay.classList.add('hidden');
}

/**
 * Try to play video
 */
export function tryPlayVideo() {
    if (!remoteVideo.srcObject) return;

    // First try: play with sound
    remoteVideo.muted = false;
    remoteVideo.play().then(() => {
        console.log('Video playing with sound!');
        hideOverlay();
    }).catch(err => {
        console.log('Play with sound failed, trying muted:', err.message);

        // Second try: play muted
        remoteVideo.muted = true;
        remoteVideo.play().then(() => {
            console.log('Video playing muted');
            showPlayOverlay('Tap to enable sound');
        }).catch(err2 => {
            console.log('Even muted play failed:', err2.message);
            showPlayOverlay('Tap to play');
        });
    });
}

/**
 * Handle user interaction
 */
export function handleUserInteraction() {
    if (userHasInteracted) return;
    userHasInteracted = true;
    console.log('User interaction detected');

    if (remoteVideo.srcObject) {
        remoteVideo.muted = false;
        remoteVideo.play().then(() => {
            console.log('Video playing after interaction');
            overlay.classList.add('hidden');
        }).catch(e => console.log('Play after interaction failed:', e));
    }

    if (onUserInteraction) onUserInteraction();
}

/**
 * Update audio-only indicator
 */
export function updateAudioOnlyIndicator() {
    console.log('updateAudioOnlyIndicator: hasVideoTrack=', hasVideoTrack, 'isConnected=', getIsConnected(), 'audioOnlyMode=', audioOnlyMode);
    const subtextEl = audioOnlyIndicator.querySelector('.audio-only-subtext');

    if (hasVideoTrack) {
        audioOnlyIndicator.classList.remove('active');
        videoContainer.classList.remove('audio-only');
    } else if (getIsConnected()) {
        console.log('Showing audio-only indicator');
        audioOnlyIndicator.classList.add('active');
        videoContainer.classList.add('audio-only');
        if (audioOnlyMode) {
            subtextEl.textContent = 'Saving bandwidth';
        } else {
            subtextEl.textContent = 'Video disabled on sender';
        }
    } else {
        audioOnlyIndicator.classList.remove('active');
        videoContainer.classList.remove('audio-only');
    }
}

/**
 * Handle incoming video track
 */
export function handleVideoTrack(track, savedVolume) {
    console.log('Video track received, showing video');
    console.log('Video track enabled:', track.enabled);
    console.log('Video track readyState:', track.readyState);
    console.log('Video track muted:', track.muted);

    hasVideoTrack = true;
    updateAudioOnlyIndicator();

    // Apply saved volume
    if (savedVolume !== null) {
        remoteVideo.volume = parseInt(savedVolume) / 100;
    }

    // Monitor track for unmute
    track.onunmute = () => {
        console.log('Video track unmuted - data flowing');
        remoteVideo.play().catch(err => {
            console.log('Play error on track unmute:', err);
            showPlayOverlay();
        });
    };

    // Monitor track ended
    track.onended = () => {
        console.log('Video track ended');
        hasVideoTrack = false;
        updateAudioOnlyIndicator();
    };

    // Force play (muted for autoplay policy)
    remoteVideo.muted = true;
    remoteVideo.play().then(() => {
        console.log('Video playing (muted), dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
        if (userHasInteracted) {
            remoteVideo.muted = false;
            overlay.classList.add('hidden');
        } else {
            showPlayOverlay();
        }
    }).catch(err => {
        console.error('Video play error:', err);
        showPlayOverlay();
    });

    // Check dimensions after delay
    setTimeout(() => {
        console.log('Video check - dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
        console.log('Video check - paused:', remoteVideo.paused);
        console.log('Video check - readyState:', remoteVideo.readyState);
        console.log('Stream active:', remoteVideo.srcObject?.active);
    }, 2000);
}

// Getters and setters
export function hasUserInteracted() { return userHasInteracted; }
export function getHasVideoTrack() { return hasVideoTrack; }
export function setHasVideoTrack(value) { hasVideoTrack = value; }
export function getAudioOnlyMode() { return audioOnlyMode; }
export function setAudioOnlyMode(value) {
    audioOnlyMode = value;
    localStorage.setItem('receiver-audio-only', value);
}
export function getRemoteVideo() { return remoteVideo; }
