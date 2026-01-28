/**
 * Keep-Awake System
 * Multiple fallback mechanisms to prevent phone from sleeping
 */

let wakeLock = null;
let wakeLockInterval = null;
let noSleepVideo = null;
let keepAliveAudio = null;
let lastWakeLockLog = 0;

/**
 * Rate-limited logging for wake lock events
 */
function wakeLockLog(msg) {
    const now = Date.now();
    if (now - lastWakeLockLog >= 5000) {
        console.log(msg);
        lastWakeLockLog = now;
    }
}

/**
 * Request a screen wake lock
 */
export async function requestWakeLock() {
    // Release existing lock first to avoid leaks
    if (wakeLock) {
        try {
            await wakeLock.release();
        } catch (e) {}
        wakeLock = null;
    }

    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLockLog('Wake lock acquired');

            // Listen for release events (OS can release anytime)
            wakeLock.addEventListener('release', () => {
                wakeLockLog('Wake lock released by system, re-acquiring...');
                // Small delay to avoid rapid re-acquisition loops
                setTimeout(requestWakeLock, 1000);
            });
        }
    } catch (err) {
        console.log('Wake lock failed:', err.message);
    }
}

/**
 * Start periodic wake lock refresh (every 30 seconds)
 */
export function startWakeLockRefresh() {
    if (wakeLockInterval) clearInterval(wakeLockInterval);
    wakeLockInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            wakeLockLog('Periodic wake lock refresh');
            requestWakeLock();
        }
    }, 30000);
}

/**
 * NoSleep.js technique: hidden video that keeps screen awake
 */
export function createNoSleepVideo() {
    if (noSleepVideo) return noSleepVideo;

    // Minimal valid MP4 (from NoSleep.js) - works across browsers
    const mp4Data = 'data:video/mp4;base64,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';

    noSleepVideo = document.createElement('video');
    noSleepVideo.setAttribute('playsinline', '');
    noSleepVideo.setAttribute('muted', '');
    noSleepVideo.muted = true; // Also set property for some browsers
    noSleepVideo.setAttribute('loop', '');
    noSleepVideo.style.cssText = 'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    noSleepVideo.src = mp4Data;
    document.body.appendChild(noSleepVideo);

    // Try to play (may need user interaction first)
    noSleepVideo.play().catch(() => {
        console.log('NoSleep video needs user interaction');
    });

    return noSleepVideo;
}

/**
 * Get the NoSleep video element if it exists
 */
export function getNoSleepVideo() {
    return noSleepVideo;
}

/**
 * Silent audio keep-alive (plays inaudible tone)
 */
export function createKeepAliveAudio() {
    if (keepAliveAudio) return keepAliveAudio;

    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        // Inaudible: 1Hz at zero volume
        oscillator.frequency.value = 1;
        gainNode.gain.value = 0.001; // Nearly silent

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();

        keepAliveAudio = { audioCtx, oscillator, gainNode };
        console.log('Keep-alive audio started');
        return keepAliveAudio;
    } catch (err) {
        console.log('Keep-alive audio failed:', err.message);
        return null;
    }
}

/**
 * Initialize all keep-awake mechanisms
 */
export function initKeepAwake() {
    requestWakeLock();
    startWakeLockRefresh();
    createNoSleepVideo();

    // Re-acquire on visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            wakeLockLog('Page visible, refreshing keep-awake');
            requestWakeLock();
            if (noSleepVideo) {
                noSleepVideo.play().catch(() => {});
            }
        }
    });

    // Start keep-awake on first user interaction (needed for video/audio autoplay)
    document.addEventListener('click', function initOnInteraction() {
        createKeepAliveAudio();
        if (noSleepVideo) {
            noSleepVideo.play().catch(() => {});
        }
        document.removeEventListener('click', initOnInteraction);
    }, { once: true });
}
