/**
 * Keep-Awake System
 * Multiple fallback mechanisms to prevent phone from sleeping
 */

let wakeLock = null;
let wakeLockInterval = null;
let noSleepVideo = null;
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
 * Uses a minimal WebM video that's more compatible with modern browsers
 */
export function createNoSleepVideo() {
    if (noSleepVideo) return noSleepVideo;

    // Minimal WebM video (VP8 codec) - better cross-browser compatibility
    // This is a tiny 1x1 pixel, 1-frame WebM that loops
    const webmData = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAITEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggH97AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAXgAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIvf5M1clupuycgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QCYloA4JCwgQG6gQGagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIvf5M1clupuxnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjEyMDAwMDAwMAAfQ7Z11eeBAKOigQAAgBACAJ0BKgEAAQALxwiFhYiFhIg/ggAMDWAA/ua1AKOVgQAoALEBAC8R/AAYABhYL/QAJAAAo5WBAFAAsQEALxH8ABgAGFgv9AAkAAAcU7trkbuPs4EAt4r3gQHxggGj8IED';

    noSleepVideo = document.createElement('video');
    noSleepVideo.setAttribute('playsinline', '');
    noSleepVideo.setAttribute('muted', '');
    noSleepVideo.muted = true; // Also set property for some browsers
    noSleepVideo.setAttribute('loop', '');
    noSleepVideo.style.cssText = 'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01;pointer-events:none;';

    // Handle decode errors gracefully - Wake Lock API is the primary mechanism anyway
    noSleepVideo.addEventListener('error', () => {
        console.log('NoSleep video fallback not supported on this browser');
    });

    noSleepVideo.src = webmData;
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

    // Start NoSleep video on first user interaction (needed for autoplay)
    document.addEventListener('click', function initOnInteraction() {
        if (noSleepVideo) {
            noSleepVideo.play().catch(() => {});
        }
        document.removeEventListener('click', initOnInteraction);
    }, { once: true });
}
