/**
 * Server-Sent Events (SSE) management
 * Handles SSE connections for senders and receivers
 */

const { generateId } = require('./utils');
const { getSession, hasSender, cleanupSession } = require('./session-manager');

/**
 * Send SSE message to a client
 * @param {http.ServerResponse} res
 * @param {object} data
 * @returns {boolean} Whether message was sent successfully
 */
function sendSSE(res, data) {
    if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
    }
    return false;
}

/**
 * Broadcast to all receivers in a session
 * @param {string} sessionName
 * @param {object} message
 */
function broadcastToReceivers(sessionName, message) {
    const { getSession } = require('./session-manager');
    const session = getSession(sessionName);
    if (!session) return;
    console.log('Broadcasting to receivers in session', sessionName, ':', message.type, 'count:', session.receivers.size);
    session.receivers.forEach((res, id) => {
        if (!sendSSE(res, message)) {
            session.receivers.delete(id);
        }
    });
}

/**
 * Send to sender in a session
 * @param {string} sessionName
 * @param {object} message
 */
function sendToSender(sessionName, message) {
    const { getSession } = require('./session-manager');
    const session = getSession(sessionName);
    if (!session) return;
    console.log('Sending to sender in session', sessionName, ':', message.type);
    if (session.senderRes) {
        if (!sendSSE(session.senderRes, message)) {
            session.sender = null;
            session.senderRes = null;
        }
    }
}

/**
 * Send to a specific receiver in a session
 * @param {string} sessionName
 * @param {string} receiverId
 * @param {object} message
 */
function sendToReceiver(sessionName, receiverId, message) {
    const { getSession } = require('./session-manager');
    const session = getSession(sessionName);
    if (!session) return;
    const res = session.receivers.get(receiverId);
    if (res) {
        console.log('Sending to receiver', receiverId, 'in session', sessionName, ':', message.type);
        if (!sendSSE(res, message)) {
            session.receivers.delete(receiverId);
        }
    } else {
        console.log('Receiver', receiverId, 'not found in session', sessionName);
    }
}

/**
 * Setup SSE headers
 * @param {http.ServerResponse} res
 */
function setupSSE(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true'
    });
    // Send initial comment to establish connection
    res.write(':ok\n\n');
}

/**
 * Handle SSE sender endpoint
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} sessionName
 */
function handleSenderSSE(req, res, sessionName) {
    const id = generateId();
    const session = getSession(sessionName);

    // If sender already exists, close old connection (allows page refresh/takeover)
    if (session.sender !== null && session.senderRes !== null) {
        console.log('Replacing existing sender in session', sessionName);
        try {
            sendSSE(session.senderRes, { type: 'replaced', message: 'Another sender connected' });
            session.senderRes.end();
        } catch (e) {
            // Old connection might already be dead
        }
        session.sender = null;
        session.senderRes = null;
    }

    setupSSE(res);

    session.sender = id;
    session.senderRes = res;
    console.log('Sender connected to session', sessionName, ':', id);

    // Send registration confirmation
    sendSSE(res, { type: 'registered', role: 'sender' });

    // Notify all receivers in this session that sender is available
    broadcastToReceivers(sessionName, { type: 'sender-available' });

    // Keep connection alive with heartbeat (15s for aggressive proxies)
    const heartbeat = setInterval(() => {
        if (!sendSSE(res, { type: 'heartbeat' })) {
            clearInterval(heartbeat);
        }
    }, 15000);

    // Handle disconnect
    req.on('close', () => {
        console.log('Sender disconnected from session', sessionName, ':', id);
        clearInterval(heartbeat);
        if (session.sender === id) {
            session.sender = null;
            session.senderRes = null;
            broadcastToReceivers(sessionName, { type: 'sender-disconnected' });
            cleanupSession(sessionName);
        }
    });
}

/**
 * Handle SSE receiver endpoint
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} sessionName
 */
function handleReceiverSSE(req, res, sessionName) {
    const id = generateId();
    const session = getSession(sessionName);

    setupSSE(res);

    session.receivers.set(id, res);
    console.log('Receiver connected to session', sessionName, ':', id, 'total:', session.receivers.size);

    // Send registration confirmation
    sendSSE(res, {
        type: 'registered',
        role: 'receiver',
        receiverId: id,
        senderAvailable: hasSender(sessionName)
    });

    // Keep connection alive with heartbeat (15s for aggressive proxies)
    const heartbeat = setInterval(() => {
        if (!sendSSE(res, { type: 'heartbeat' })) {
            clearInterval(heartbeat);
            session.receivers.delete(id);
        }
    }, 15000);

    // Handle disconnect
    req.on('close', () => {
        console.log('Receiver disconnected from session', sessionName, ':', id, 'remaining:', session.receivers.size - 1);
        clearInterval(heartbeat);
        session.receivers.delete(id);
        if (session.receivers.size === 0) {
            sendToSender(sessionName, { type: 'no-receivers' });
        }
        cleanupSession(sessionName);
    });
}

module.exports = {
    sendSSE,
    broadcastToReceivers,
    sendToReceiver,
    sendToSender,
    setupSSE,
    handleSenderSSE,
    handleReceiverSSE
};
