/**
 * Keep-Awake System
 * Multiple fallback mechanisms to prevent phone from sleeping
 */

let wakeLock = null;
let wakeLockInterval = null;
let noSleepVideo = null;
let lastWakeLockLog = 0;
let autoShutdownInterval = null;
let autoShutdownEndTime = null;
let autoShutdownCallback = null;
let autoShutdownStatusCallback = null;
let autoShutdownHours = 6; // Default: 6 hours (or seconds in debug mode)
let autoShutdownUnit = 'hours'; // 'hours' or 'seconds'

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

/**
 * Set the auto-shutdown timeout
 * @param {number} value - Time before auto-shutdown (0 to disable)
 * @param {string} unit - 'hours' or 'seconds'
 */
export function setAutoShutdownTime(value, unit = 'hours') {
    autoShutdownHours = value;
    autoShutdownUnit = unit;
    console.log('Auto-shutdown set to', value, unit);
}

// Legacy function for backwards compatibility
export function setAutoShutdownHours(hours) {
    setAutoShutdownTime(hours, 'hours');
}

/**
 * Get remaining time until auto-shutdown in milliseconds
 */
export function getAutoShutdownRemaining() {
    if (!autoShutdownInterval || !autoShutdownEndTime) return null;
    return Math.max(0, autoShutdownEndTime - Date.now());
}

/**
 * Check if auto-shutdown timer is currently running
 */
export function getAutoShutdownActive() {
    return autoShutdownInterval !== null && autoShutdownEndTime !== null;
}

/**
 * Register a callback that fires every second with shutdown status
 * @param {Function} callback - Called with {active, remainingMs}
 */
export function setShutdownStatusCallback(callback) {
    autoShutdownStatusCallback = callback;
}

/**
 * Start the auto-shutdown timer
 * @param {Function} onShutdown - Callback when shutdown is triggered
 */
export function startAutoShutdown(onShutdown) {
    if (autoShutdownHours <= 0) {
        console.log('Auto-shutdown disabled');
        cancelAutoShutdown();
        // Notify that shutdown is now inactive
        if (autoShutdownStatusCallback) {
            autoShutdownStatusCallback({ active: false, remainingMs: 0 });
        }
        return;
    }

    cancelAutoShutdown();

    autoShutdownCallback = onShutdown;
    const timeoutMs = autoShutdownUnit === 'seconds'
        ? autoShutdownHours * 1000
        : autoShutdownHours * 60 * 60 * 1000;

    autoShutdownEndTime = Date.now() + timeoutMs;

    // Use setInterval (1s tick) so we can broadcast status and detect expiry
    autoShutdownInterval = setInterval(() => {
        const remaining = autoShutdownEndTime - Date.now();
        if (remaining <= 0) {
            console.log('Auto-shutdown triggered after', autoShutdownHours, autoShutdownUnit);
            triggerAutoShutdown();
        } else if (autoShutdownStatusCallback) {
            autoShutdownStatusCallback({ active: true, remainingMs: remaining });
        }
    }, 1000);

    // Fire initial status immediately
    if (autoShutdownStatusCallback) {
        autoShutdownStatusCallback({ active: true, remainingMs: timeoutMs });
    }

    console.log('Auto-shutdown timer started:', autoShutdownHours, autoShutdownUnit);
}

/**
 * Cancel the auto-shutdown timer
 */
export function cancelAutoShutdown() {
    if (autoShutdownInterval) {
        clearInterval(autoShutdownInterval);
        autoShutdownInterval = null;
        autoShutdownEndTime = null;
        console.log('Auto-shutdown timer cancelled');
    }
}

/**
 * Trigger auto-shutdown - release all resources and call callback
 */
function triggerAutoShutdown() {
    console.log('Triggering auto-shutdown to save battery');

    // Notify status callback that shutdown fired
    if (autoShutdownStatusCallback) {
        autoShutdownStatusCallback({ active: false, remainingMs: 0 });
    }

    // First call the callback (which should stop streaming)
    if (autoShutdownCallback) {
        try {
            autoShutdownCallback();
        } catch (e) {
            console.error('Auto-shutdown callback error:', e);
        }
    }

    // Then release all keep-awake resources
    destroyKeepAwake();
}

/**
 * Release all keep-awake resources
 */
export function destroyKeepAwake() {
    cancelAutoShutdown();
    
    if (wakeLockInterval) {
        clearInterval(wakeLockInterval);
        wakeLockInterval = null;
    }
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
    if (noSleepVideo) {
        noSleepVideo.pause();
        noSleepVideo.remove();
        noSleepVideo = null;
    }
    console.log('Keep-awake resources released - phone can sleep now');
}
