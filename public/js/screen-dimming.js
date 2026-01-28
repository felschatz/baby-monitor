/**
 * Screen dimming functionality for sender
 * Saves battery by dimming screen after inactivity
 */

const DIM_TIMEOUT = 5000; // 5 seconds
const WARNING_TIME = 2000; // Show warning 2 seconds before dimming

let dimTimer = null;
let warningTimer = null;
let countdownInterval = null;
let isScreenOff = false;

// DOM elements (set via init)
let screenOffOverlay = null;
let dimIndicator = null;
let countdownBar = null;

/**
 * Initialize screen dimming
 * @param {object} elements
 * @param {HTMLElement} elements.screenOffOverlay
 * @param {HTMLElement} elements.dimIndicator
 * @param {HTMLElement} elements.countdownBar
 */
export function initScreenDimming(elements) {
    screenOffOverlay = elements.screenOffOverlay;
    dimIndicator = elements.dimIndicator;
    countdownBar = elements.countdownBar;

    // Wake screen on overlay tap
    screenOffOverlay.addEventListener('click', wakeScreen);
    screenOffOverlay.addEventListener('touchstart', wakeScreen);

    // Reset timer on any user interaction
    const interactionEvents = ['mousedown', 'mousemove', 'touchstart', 'touchmove', 'scroll', 'keydown'];
    interactionEvents.forEach(event => {
        document.addEventListener(event, () => {
            if (!isScreenOff) {
                resetDimTimer();
            }
        }, { passive: true });
    });

    // Start the dim timer
    resetDimTimer();
}

/**
 * Reset the dim timer (call on user activity)
 */
export function resetDimTimer() {
    // Clear existing timers
    clearTimeout(dimTimer);
    clearTimeout(warningTimer);
    clearInterval(countdownInterval);

    // Hide the indicator
    if (dimIndicator) {
        dimIndicator.classList.remove('visible');
    }
    if (countdownBar) {
        countdownBar.style.width = '100%';
    }

    // If screen is off, wake it up
    if (isScreenOff) {
        wakeScreen();
        return;
    }

    // Start warning timer (shows indicator before screen dims)
    warningTimer = setTimeout(() => {
        showDimWarning();
    }, DIM_TIMEOUT - WARNING_TIME);

    // Start dim timer
    dimTimer = setTimeout(() => {
        dimScreen();
    }, DIM_TIMEOUT);
}

/**
 * Show warning indicator before dimming
 */
function showDimWarning() {
    if (!dimIndicator || !countdownBar) return;

    dimIndicator.classList.add('visible');
    countdownBar.style.width = '100%';

    let remaining = WARNING_TIME;
    const step = 50; // Update every 50ms

    countdownInterval = setInterval(() => {
        remaining -= step;
        const percent = (remaining / WARNING_TIME) * 100;
        countdownBar.style.width = percent + '%';

        if (remaining <= 0) {
            clearInterval(countdownInterval);
        }
    }, step);
}

/**
 * Dim the screen
 */
function dimScreen() {
    isScreenOff = true;
    if (screenOffOverlay) {
        screenOffOverlay.classList.add('active');
    }
    if (dimIndicator) {
        dimIndicator.classList.remove('visible');
    }
    clearInterval(countdownInterval);
}

/**
 * Wake the screen
 */
export function wakeScreen() {
    isScreenOff = false;
    if (screenOffOverlay) {
        screenOffOverlay.classList.remove('active');
    }
    resetDimTimer();
}

/**
 * Check if screen is currently dimmed
 */
export function isScreenDimmed() {
    return isScreenOff;
}
