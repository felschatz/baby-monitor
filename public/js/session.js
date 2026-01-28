/**
 * Session management for the baby monitor
 * Handles URL parsing, localStorage, and session prompts
 */

/**
 * Extract session name from URL path
 * @param {string} prefix - Path prefix (e.g., '/s/' or '/r/')
 * @returns {string|null} Session name or null if not found
 */
export function getSessionFromPath(prefix) {
    const regex = new RegExp(`^${prefix}(.+)$`);
    const pathMatch = window.location.pathname.match(regex);
    return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
}

/**
 * Get saved session from localStorage
 * @returns {string|null}
 */
export function getSavedSession() {
    return localStorage.getItem('babymonitor-session');
}

/**
 * Save session to localStorage
 * @param {string} sessionName
 */
export function saveSession(sessionName) {
    localStorage.setItem('babymonitor-session', sessionName);
}

/**
 * Setup session prompt overlay
 * @param {object} options
 * @param {HTMLElement} options.overlay - Session overlay element
 * @param {HTMLInputElement} options.input - Session input element
 * @param {HTMLButtonElement} options.button - Join button element
 * @param {string} options.redirectPrefix - URL prefix for redirect (e.g., '/s/' or '/r/')
 * @param {string} [options.queryString] - Additional query string to preserve
 * @returns {boolean} Whether session prompt was shown
 */
export function setupSessionPrompt(options) {
    const { overlay, input, button, redirectPrefix, queryString = '' } = options;

    // Pre-fill from localStorage if available
    const savedSession = getSavedSession();
    if (savedSession) {
        input.value = savedSession;
    }

    function joinSession() {
        const name = input.value.trim();
        if (!name) {
            input.focus();
            return;
        }
        // Redirect to session URL
        const qs = queryString ? `?${queryString}` : '';
        window.location.href = `${redirectPrefix}${encodeURIComponent(name)}${qs}`;
    }

    button.addEventListener('click', joinSession);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinSession();
    });

    overlay.style.display = 'flex';
    return true;
}

/**
 * Initialize session - returns session name or shows prompt
 * @param {object} options
 * @param {string} options.pathPrefix - Path prefix to check for session (e.g., '/s/' or '/r/')
 * @param {HTMLElement} options.overlay - Session overlay element
 * @param {HTMLInputElement} options.input - Session input element
 * @param {HTMLButtonElement} options.button - Join button element
 * @param {string} options.redirectPrefix - URL prefix for redirect (e.g., '/s/' or '/r/')
 * @param {string} [options.queryString] - Additional query string to preserve
 * @returns {string|null} Session name or null if prompt shown
 */
export function initSession(options) {
    const { pathPrefix, overlay, input, button, redirectPrefix, queryString } = options;

    const sessionName = getSessionFromPath(pathPrefix);

    if (!sessionName) {
        // No session in URL - show prompt
        setupSessionPrompt({ overlay, input, button, redirectPrefix, queryString });
        return null;
    }

    // Session in URL - save to localStorage and proceed
    saveSession(sessionName);
    overlay.style.display = 'none';
    return sessionName;
}
