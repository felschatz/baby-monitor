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
let onMediaMuted = null;
let isAudioRoutedThroughWebAudio = null;

// Track mute state
let videoTrackMuted = false;
let audioTrackMuted = false;
let mediaMutedTimeout = null;

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
    onMediaMuted = callbacks.onMediaMuted;
    isAudioRoutedThroughWebAudio = callbacks.isAudioRoutedThroughWebAudio;

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

    // Handle overlay click - always retry play regardless of previous interaction state
    overlay.addEventListener('click', () => {
        console.log('Overlay tapped, attempting to play');
        userHasInteracted = true;
        if (onUserInteraction) onUserInteraction();

        if (remoteVideo.srcObject) {
            safeUnmuteVideo();
            remoteVideo.play().then(() => {
                console.log('Play succeeded after overlay tap');
                overlay.classList.add('hidden');
            }).catch(e => {
                console.log('Overlay play error:', e);
                // Try one more time with a slight delay
                setTimeout(() => {
                    remoteVideo.play().catch(e2 => console.log('Retry play also failed:', e2));
                }, 100);
            });
        } else {
            console.log('No srcObject yet, waiting for stream');
        }
    });
}

/**
 * Check and report media muted state
 * Uses a short delay to avoid false positives during renegotiation
 */
function checkMediaMutedState() {
    clearTimeout(mediaMutedTimeout);

    const isMuted = (hasVideoTrack && videoTrackMuted) || audioTrackMuted;

    if (isMuted && getIsConnected()) {
        // Delay before reporting muted to avoid transient states
        mediaMutedTimeout = setTimeout(() => {
            if (onMediaMuted) {
                console.log('Media muted - sender screen likely off');
                onMediaMuted(true);
            }
        }, 1000);
    } else if (!isMuted) {
        if (onMediaMuted) {
            console.log('Media unmuted - sender screen likely back on');
            onMediaMuted(false);
        }
    }
}

/**
 * Reset media muted state (call when connection closes)
 */
export function resetMediaMutedState() {
    clearTimeout(mediaMutedTimeout);
    videoTrackMuted = false;
    audioTrackMuted = false;
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
 * Safely unmute video element
 * Audio always plays directly through the video element for Bluetooth compatibility
 */
function safeUnmuteVideo() {
    remoteVideo.muted = false;
}

/**
 * Try to play video
 */
export function tryPlayVideo() {
    if (!remoteVideo.srcObject) return;

    // First try: play with sound (unless audio routed through Web Audio)
    safeUnmuteVideo();
    remoteVideo.play().then(() => {
        console.log('Video playing with sound!');
        hideOverlay();
    }).catch(err => {
        console.log('Play with sound failed, trying muted:', err.message);

        // Second try: play muted (for autoplay policy)
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

    // Call onUserInteraction first to set up noise gate if needed
    if (onUserInteraction) onUserInteraction();

    if (remoteVideo.srcObject) {
        safeUnmuteVideo();
        remoteVideo.play().then(() => {
            console.log('Video playing after interaction');
            overlay.classList.add('hidden');
        }).catch(e => {
            console.log('Play after interaction failed:', e);
            showPlayOverlay('Tap to enable sound');
        });
    }
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

    // Monitor track for mute (sender screen off)
    track.onmute = () => {
        console.log('Video track muted - sender may have screen off');
        videoTrackMuted = true;
        checkMediaMutedState();
    };

    // Monitor track for unmute (data flowing again)
    track.onunmute = () => {
        console.log('Video track unmuted - data flowing');
        videoTrackMuted = false;
        checkMediaMutedState();
        remoteVideo.play().catch(err => {
            console.log('Play error on track unmute:', err);
            showPlayOverlay();
        });
    };

    // Monitor track ended
    track.onended = () => {
        console.log('Video track ended');
        hasVideoTrack = false;
        videoTrackMuted = false;
        updateAudioOnlyIndicator();
    };

    // Force play (muted for autoplay policy)
    remoteVideo.muted = true;
    remoteVideo.play().then(() => {
        console.log('Video playing (muted), dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
        if (userHasInteracted) {
            safeUnmuteVideo();
            remoteVideo.play().then(() => {
                overlay.classList.add('hidden');
            }).catch(err => {
                console.log('Unmuted play failed:', err);
                showPlayOverlay('Tap to enable sound');
            });
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

/**
 * Set up audio track mute detection
 * @param {MediaStreamTrack} track - Audio track to monitor
 */
export function setupAudioTrackMuteDetection(track) {
    console.log('Setting up audio track mute detection');

    track.onmute = () => {
        console.log('Audio track muted - sender may have screen off');
        audioTrackMuted = true;
        checkMediaMutedState();
    };

    track.onunmute = () => {
        console.log('Audio track unmuted - data flowing');
        audioTrackMuted = false;
        checkMediaMutedState();
    };

    track.onended = () => {
        console.log('Audio track ended');
        audioTrackMuted = false;
    };
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

/**
 * Cleanup video playback resources
 */
export function destroyVideoPlayback() {
    clearTimeout(mediaMutedTimeout);
    userHasInteracted = false;
    hasVideoTrack = false;
    videoTrackMuted = false;
    audioTrackMuted = false;
}
