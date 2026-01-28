/**
 * Session management for the baby monitor
 * Each session has its own sender and receivers
 */

// Session-based data structure
// sessions.get(sessionName) = { sender, senderRes, receivers: Map }
const sessions = new Map();

/**
 * Get or create a session
 * @param {string} sessionName
 * @returns {object} Session object with sender, senderRes, and receivers
 */
function getSession(sessionName) {
    if (!sessions.has(sessionName)) {
        sessions.set(sessionName, {
            sender: null,
            senderRes: null,
            receivers: new Map()
        });
        console.log('Created session:', sessionName);
    }
    return sessions.get(sessionName);
}

/**
 * Check if sender is active in a session
 * @param {string} sessionName
 * @returns {boolean}
 */
function hasSender(sessionName) {
    const session = sessions.get(sessionName);
    return session && session.sender !== null && session.senderRes !== null;
}

/**
 * Clean up empty sessions
 * @param {string} sessionName
 */
function cleanupSession(sessionName) {
    const session = sessions.get(sessionName);
    if (session && !session.sender && session.receivers.size === 0) {
        sessions.delete(sessionName);
        console.log('Deleted empty session:', sessionName);
    }
}

/**
 * Get all sessions (for status endpoint)
 * @returns {Map}
 */
function getAllSessions() {
    return sessions;
}

module.exports = {
    getSession,
    hasSender,
    cleanupSession,
    getAllSessions
};
