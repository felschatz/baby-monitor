/**
 * Signal routing for WebRTC signaling
 * Handles all message types between senders and receivers
 */

const { parseJsonBody, sendJson } = require('./utils');
const { hasSender } = require('./session-manager');
const { broadcastToReceivers, sendToSender } = require('./sse-manager');

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
                sendToSender(sessionName, { type: 'request-offer', videoEnabled: message.videoEnabled });
            }
            break;

        case 'video-request':
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'video-request', enabled: message.enabled });
            }
            break;

        case 'offer':
            broadcastToReceivers(sessionName, { type: 'offer', offer: message.offer });
            break;

        case 'answer':
            sendToSender(sessionName, { type: 'answer', answer: message.answer });
            break;

        case 'ptt-offer':
            console.log('Forwarding PTT offer to sender in session', sessionName);
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'ptt-offer', offer: message.offer });
            }
            break;

        case 'ptt-start':
            sendToSender(sessionName, { type: 'ptt-start' });
            break;

        case 'ptt-answer':
            broadcastToReceivers(sessionName, { type: 'ptt-answer', answer: message.answer });
            break;

        case 'ptt-stop':
            sendToSender(sessionName, { type: 'ptt-stop' });
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

        case 'echo-cancel-status':
            // Sender -> Receivers: acknowledge state
            broadcastToReceivers(sessionName, {
                type: 'echo-cancel-status',
                enabled: message.enabled,
                active: message.active
            });
            break;

        case 'ice-candidate':
            if (message.role === 'sender') {
                broadcastToReceivers(sessionName, { type: 'ice-candidate', candidate: message.candidate });
            } else {
                sendToSender(sessionName, { type: 'ice-candidate', candidate: message.candidate });
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
