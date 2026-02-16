/**
 * Signal routing for WebRTC signaling
 * Handles all message types between senders and receivers
 */

const { parseJsonBody, sendJson } = require('./utils');
const { hasSender } = require('./session-manager');
const { broadcastToReceivers, sendToReceiver, sendToSender } = require('./sse-manager');

/**
 * Handle signal endpoint
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleSignal(req, res) {
    let message;
    try {
        message = await parseJsonBody(req);
    } catch (e) {
        return sendJson(res, { error: 'Invalid JSON' }, 400);
    }

    if (!message || !message.type) {
        return sendJson(res, { error: 'Invalid message' }, 400);
    }

    const sessionName = message.session;
    if (!sessionName) {
        return sendJson(res, { error: 'Session required' }, 400);
    }

    console.log('Signal received in session', sessionName, ':', message.type, 'from', message.role || 'unknown');

    switch (message.type) {
        case 'request-offer':
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'request-offer', videoEnabled: message.videoEnabled, receiverId: message.receiverId });
            }
            break;

        case 'video-request':
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'video-request', enabled: message.enabled, receiverId: message.receiverId });
            }
            break;

        case 'offer':
            // If receiverId is specified, send only to that receiver; otherwise broadcast
            if (message.receiverId) {
                sendToReceiver(sessionName, message.receiverId, { type: 'offer', offer: message.offer, pttMid: message.pttMid });
            } else {
                broadcastToReceivers(sessionName, { type: 'offer', offer: message.offer, pttMid: message.pttMid });
            }
            break;

        case 'answer':
            sendToSender(sessionName, { type: 'answer', answer: message.answer, receiverId: message.receiverId });
            break;

        case 'ptt-offer':
            console.log('Forwarding PTT offer to sender in session', sessionName);
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'ptt-offer', offer: message.offer, receiverId: message.receiverId });
            }
            break;

        case 'ptt-start':
            sendToSender(sessionName, { type: 'ptt-start', receiverId: message.receiverId });
            break;

        case 'ptt-answer':
            // If receiverId is specified, send only to that receiver; otherwise broadcast
            if (message.receiverId) {
                sendToReceiver(sessionName, message.receiverId, { type: 'ptt-answer', answer: message.answer });
            } else {
                broadcastToReceivers(sessionName, { type: 'ptt-answer', answer: message.answer });
            }
            break;

        case 'ptt-stop':
            sendToSender(sessionName, { type: 'ptt-stop', receiverId: message.receiverId });
            break;

        case 'music-start':
            if (hasSender(sessionName)) {
                sendToSender(sessionName, {
                    type: 'music-start',
                    timerMinutes: message.timerMinutes,
                    playlist: message.playlist
                });
            }
            break;

        case 'music-stop':
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'music-stop' });
            }
            break;

        case 'music-timer-reset':
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'music-timer-reset', timerMinutes: message.timerMinutes });
            }
            break;

        case 'music-status':
            broadcastToReceivers(sessionName, {
                type: 'music-status',
                playing: message.playing,
                currentTrack: message.currentTrack,
                timerRemaining: message.timerRemaining
            });
            break;

        case 'echo-cancel-enable':
            // Receiver -> Sender: toggle spectral subtraction
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'echo-cancel-enable', enabled: message.enabled });
            }
            break;

        case 'test-sound':
            // Receiver -> Sender: trigger a short ping through the outgoing audio stream
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'test-sound', receiverId: message.receiverId });
            } else {
                console.log('Test sound ignored: no sender in session', sessionName);
                return sendJson(res, { error: 'Sender not connected' }, 409);
            }
            break;
        case 'sensitivity-sound':
            // Receiver -> Sender: trigger sensitivity alert sound through outgoing audio stream
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'sensitivity-sound', receiverId: message.receiverId });
            } else {
                console.log('Sensitivity sound ignored: no sender in session', sessionName);
                return sendJson(res, { error: 'Sender not connected' }, 409);
            }
            break;
        case 'test-sound-status':
            // Sender -> Receiver(s): report test sound status
            if (message.receiverId) {
                sendToReceiver(sessionName, message.receiverId, {
                    type: 'test-sound-status',
                    status: message.status,
                    detail: message.detail
                });
            } else {
                broadcastToReceivers(sessionName, {
                    type: 'test-sound-status',
                    status: message.status,
                    detail: message.detail
                });
            }
            break;

        case 'echo-cancel-status':
            // Sender -> Receivers: acknowledge state
            broadcastToReceivers(sessionName, {
                type: 'echo-cancel-status',
                enabled: message.enabled,
                active: message.active
            });
            break;

        case 'shutdown-timeout':
            // Receiver -> Sender: set auto-shutdown timeout
            if (hasSender(sessionName)) {
                sendToSender(sessionName, {
                    type: 'shutdown-timeout',
                    value: message.value,
                    unit: message.unit
                });
            }
            break;

        case 'shutdown-now':
            // Receiver -> Sender: trigger immediate shutdown (30s countdown)
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'shutdown-now' });
            }
            break;

        case 'shutdown-status':
            // Sender -> Receivers: broadcast shutdown timer status
            broadcastToReceivers(sessionName, {
                type: 'shutdown-status',
                active: message.active,
                remainingMs: message.remainingMs
            });
            break;

        case 'sender-ready':
            // Sender -> Receivers: sender's stream is ready, request offers now
            broadcastToReceivers(sessionName, { type: 'sender-ready' });
            break;

        case 'video-unavailable':
            // Sender -> Receiver: video capture not available
            if (message.receiverId) {
                sendToReceiver(sessionName, message.receiverId, { type: 'video-unavailable' });
            } else {
                broadcastToReceivers(sessionName, { type: 'video-unavailable' });
            }
            break;

        case 'ice-candidate':
            if (message.role === 'sender') {
                // If receiverId is specified, send only to that receiver; otherwise broadcast
                if (message.receiverId) {
                    sendToReceiver(sessionName, message.receiverId, { type: 'ice-candidate', candidate: message.candidate });
                } else {
                    broadcastToReceivers(sessionName, { type: 'ice-candidate', candidate: message.candidate });
                }
            } else {
                sendToSender(sessionName, { type: 'ice-candidate', candidate: message.candidate, receiverId: message.receiverId });
            }
            break;

        default:
            console.log('Unknown message type:', message.type);
    }

    sendJson(res, { success: true });
}

module.exports = {
    handleSignal
};
