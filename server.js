const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Track connected clients
let sender = null;
let receivers = new Set();

// Broadcast to all receivers
function broadcastToReceivers(message) {
    console.log('Broadcasting to receivers:', message.type);
    receivers.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Send to sender
function sendToSender(message) {
    console.log('Sending to sender:', message.type);
    if (sender && sender.readyState === WebSocket.OPEN) {
        sender.send(JSON.stringify(message));
    }
}

// Check if sender is active
function hasSender() {
    return sender && sender.readyState === WebSocket.OPEN;
}

wss.on('connection', (ws) => {
    console.log('New connection');

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            // Log all messages except ping/pong for debugging
            if (message.type !== 'ping') {
                console.log('Received:', message.type, 'from', ws.role || 'unknown');
            }

            switch (message.type) {
                case 'register-sender':
                    if (hasSender()) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Sender already exists' }));
                        ws.close();
                        return;
                    }
                    sender = ws;
                    ws.role = 'sender';
                    console.log('Sender registered');
                    ws.send(JSON.stringify({ type: 'registered', role: 'sender' }));

                    // Notify all receivers that sender is available
                    broadcastToReceivers({ type: 'sender-available' });
                    break;

                case 'register-receiver':
                    receivers.add(ws);
                    ws.role = 'receiver';
                    console.log('Receiver registered, total receivers:', receivers.size);
                    ws.send(JSON.stringify({
                        type: 'registered',
                        role: 'receiver',
                        senderAvailable: hasSender()
                    }));
                    break;

                case 'request-offer':
                    // Receiver is requesting an offer from sender
                    console.log('Receiver requesting offer');
                    if (hasSender()) {
                        sendToSender({ type: 'request-offer' });
                    }
                    break;

                case 'offer':
                    // Forward offer from sender to all receivers
                    broadcastToReceivers({ type: 'offer', offer: message.offer });
                    break;

                case 'answer':
                    // Forward answer from receiver to sender
                    sendToSender({ type: 'answer', answer: message.answer });
                    break;

                case 'ptt-offer':
                    // Forward PTT offer from receiver to sender
                    console.log('Forwarding PTT offer to sender, sender available:', hasSender());
                    if (hasSender()) {
                        sendToSender({ type: 'ptt-offer', offer: message.offer });
                    } else {
                        console.log('No sender available for PTT');
                    }
                    break;

                case 'ptt-start':
                    // Forward PTT start from receiver to sender
                    console.log('Forwarding PTT start to sender');
                    sendToSender({ type: 'ptt-start' });
                    break;

                case 'ptt-answer':
                    // Forward PTT answer from sender to receivers
                    console.log('Forwarding PTT answer to receivers, count:', receivers.size);
                    broadcastToReceivers({ type: 'ptt-answer', answer: message.answer });
                    break;

                case 'ptt-stop':
                    // Forward PTT stop from receiver to sender
                    console.log('Forwarding PTT stop to sender');
                    sendToSender({ type: 'ptt-stop' });
                    break;

                case 'ice-candidate':
                    // Forward ICE candidates
                    if (ws.role === 'sender') {
                        broadcastToReceivers({ type: 'ice-candidate', candidate: message.candidate });
                    } else {
                        sendToSender({ type: 'ice-candidate', candidate: message.candidate });
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });

    ws.on('close', () => {
        console.log('Connection closed, role:', ws.role);

        if (ws.role === 'sender') {
            sender = null;
            // Notify all receivers that sender disconnected
            broadcastToReceivers({ type: 'sender-disconnected' });
        } else if (ws.role === 'receiver') {
            receivers.delete(ws);
            console.log('Receiver disconnected, remaining:', receivers.size);
            // Notify sender if needed
            if (receivers.size === 0) {
                sendToSender({ type: 'no-receivers' });
            }
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/sender', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sender.html'));
});

app.get('/receiver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'receiver.html'));
});

// API to check status
app.get('/api/status', (req, res) => {
    res.json({
        senderActive: hasSender(),
        receiverCount: receivers.size
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Baby Monitor server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
