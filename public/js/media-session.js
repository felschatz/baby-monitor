/**
 * Media Session API - Background audio support
 * Registers the app as a media player with the OS for lock screen controls
 * Note: Behavior varies by device/browser - marked as "Beta"
 */

let videoElement = null;
let sessionName = '';
let enabled = false;

/**
 * Check if Media Session API is supported
 */
export function isMediaSessionSupported() {
    return 'mediaSession' in navigator;
}

/**
 * Initialize media session with references
 * @param {Object} options - Initialization options
 * @param {HTMLVideoElement} options.videoElement - The video element for playback control
 * @param {string} options.sessionName - The session name to display as artist
 */
export function initMediaSession({ videoElement: video, sessionName: session }) {
    videoElement = video;
    sessionName = session;
}

/**
 * Enable or disable media session
 * @param {boolean} enable - Whether to enable media session
 */
export function setMediaSessionEnabled(enable) {
    if (!isMediaSessionSupported()) return;

    enabled = enable;

    if (enable) {
        setupMediaSession();
    } else {
        clearMediaSession();
    }
}

/**
 * Update media session state based on connection status
 * @param {boolean} connected - Whether currently connected to sender
 */
export function updateMediaSessionState(connected) {
    if (!isMediaSessionSupported() || !enabled) return;

    // Update metadata to reflect connection state
    navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Baby Monitor',
        artist: sessionName,
        album: connected ? 'Connected' : 'Waiting...'
    });

    // Update playback state
    navigator.mediaSession.playbackState = connected ? 'playing' : 'paused';
}

/**
 * Set up media session handlers and metadata
 */
function setupMediaSession() {
    if (!isMediaSessionSupported()) return;

    // Set initial metadata
    navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Baby Monitor',
        artist: sessionName,
        album: 'Waiting...'
    });

    // Set up action handlers
    navigator.mediaSession.setActionHandler('play', () => {
        if (videoElement) {
            videoElement.play().catch(err => {
                console.log('Media session play failed:', err.message);
            });
        }
    });

    // Pause handler - no-op since we don't want to pause monitoring
    navigator.mediaSession.setActionHandler('pause', () => {
        // Intentionally do nothing - we don't want to pause baby monitoring
        console.log('Media session pause ignored - monitoring continues');
    });

    navigator.mediaSession.playbackState = 'paused';
}

/**
 * Clear media session handlers
 */
function clearMediaSession() {
    if (!isMediaSessionSupported()) return;

    navigator.mediaSession.metadata = null;
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.playbackState = 'none';
}

/**
 * Clean up media session on page unload
 */
export function destroyMediaSession() {
    clearMediaSession();
    videoElement = null;
    sessionName = '';
    enabled = false;
}
