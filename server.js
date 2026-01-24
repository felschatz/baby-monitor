require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const ENABLE_DEBUG_TIMER = process.env.ENABLE_DEBUG_TIMER === 'true';

const app = express();

// Parse JSON bodies
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/mp3', express.static(path.join(__dirname, 'mp3')));

// Track connected clients using SSE
let sender = null;
let senderRes = null;
let receivers = new Map(); // id -> response object

// Generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Send SSE message to a client
function sendSSE(res, data) {
    if (res && !res.finished) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
    }
    return false;
}

// Broadcast to all receivers
function broadcastToReceivers(message) {
    console.log('Broadcasting to receivers:', message.type, 'count:', receivers.size);
    receivers.forEach((res, id) => {
        if (!sendSSE(res, message)) {
            receivers.delete(id);
        }
    });
}

// Send to sender
function sendToSender(message) {
    console.log('Sending to sender:', message.type);
    if (senderRes) {
        if (!sendSSE(senderRes, message)) {
            sender = null;
            senderRes = null;
        }
    }
}

// Check if sender is active
function hasSender() {
    return sender !== null && senderRes !== null;
}

// SSE endpoint for sender
app.get('/api/sse/sender', (req, res) => {
    const id = generateId();
    
    // Check if sender already exists
    if (hasSender()) {
        res.status(409).json({ error: 'Sender already exists' });
        return;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    sender = id;
    senderRes = res;
    console.log('Sender connected:', id);

    // Send registration confirmation
    sendSSE(res, { type: 'registered', role: 'sender' });

    // Notify all receivers that sender is available
    broadcastToReceivers({ type: 'sender-available' });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        if (!sendSSE(res, { type: 'heartbeat' })) {
            clearInterval(heartbeat);
        }
    }, 30000);

    // Handle disconnect
    req.on('close', () => {
        console.log('Sender disconnected:', id);
        clearInterval(heartbeat);
        if (sender === id) {
            sender = null;
            senderRes = null;
            broadcastToReceivers({ type: 'sender-disconnected' });
        }
    });
});

// SSE endpoint for receivers
app.get('/api/sse/receiver', (req, res) => {
    const id = generateId();

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    receivers.set(id, res);
    console.log('Receiver connected:', id, 'total:', receivers.size);

    // Send registration confirmation
    sendSSE(res, { 
        type: 'registered', 
        role: 'receiver',
        receiverId: id,
        senderAvailable: hasSender()
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        if (!sendSSE(res, { type: 'heartbeat' })) {
            clearInterval(heartbeat);
            receivers.delete(id);
        }
    }, 30000);

    // Handle disconnect
    req.on('close', () => {
        console.log('Receiver disconnected:', id, 'remaining:', receivers.size - 1);
        clearInterval(heartbeat);
        receivers.delete(id);
        if (receivers.size === 0) {
            sendToSender({ type: 'no-receivers' });
        }
    });
});

// Message endpoint (replaces WebSocket messages)
app.post('/api/signal', (req, res) => {
    const message = req.body;
    
    if (!message || !message.type) {
        return res.status(400).json({ error: 'Invalid message' });
    }

    console.log('Signal received:', message.type, 'from', message.role || 'unknown');

    switch (message.type) {
        case 'request-offer':
            // Receiver is requesting an offer from sender
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
            console.log('Forwarding PTT offer to sender');
            if (hasSender()) {
                sendToSender({ type: 'ptt-offer', offer: message.offer });
            }
            break;

        case 'ptt-start':
            // Forward PTT start from receiver to sender
            sendToSender({ type: 'ptt-start' });
            break;

        case 'ptt-answer':
            // Forward PTT answer from sender to receivers
            broadcastToReceivers({ type: 'ptt-answer', answer: message.answer });
            break;

        case 'ptt-stop':
            // Forward PTT stop from receiver to sender
            sendToSender({ type: 'ptt-stop' });
            break;

        case 'music-start':
            if (hasSender()) {
                sendToSender({ type: 'music-start', timerMinutes: message.timerMinutes });
            }
            break;

        case 'music-stop':
            if (hasSender()) {
                sendToSender({ type: 'music-stop' });
            }
            break;

        case 'music-status':
            broadcastToReceivers({
                type: 'music-status',
                playing: message.playing,
                currentTrack: message.currentTrack,
                timerRemaining: message.timerRemaining
            });
            break;

        case 'ice-candidate':
            // Forward ICE candidates
            if (message.role === 'sender') {
                broadcastToReceivers({ type: 'ice-candidate', candidate: message.candidate });
            } else {
                sendToSender({ type: 'ice-candidate', candidate: message.candidate });
            }
            break;

        default:
            console.log('Unknown message type:', message.type);
    }

    res.json({ success: true });
});

// Music API endpoint
app.get('/api/music', (req, res) => {
    const mp3Dir = path.join(__dirname, 'mp3');
    try {
        if (!fs.existsSync(mp3Dir)) {
            return res.json({ files: [], debugTimer: ENABLE_DEBUG_TIMER });
        }
        const files = fs.readdirSync(mp3Dir)
            .filter(file => file.toLowerCase().endsWith('.mp3'))
            .map(file => ({
                name: file.replace(/\.mp3$/i, ''),
                url: `/mp3/${encodeURIComponent(file)}`
            }));
        res.json({ files, debugTimer: ENABLE_DEBUG_TIMER });
    } catch (err) {
        res.json({ files: [], debugTimer: ENABLE_DEBUG_TIMER });
    }
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
app.listen(PORT, () => {
    console.log(`Baby Monitor server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log('Using SSE for signaling (no WebSockets required)');
});
