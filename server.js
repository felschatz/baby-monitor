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

// Session-based data structure
// sessions.get(sessionName) = { sender, senderRes, receivers: Map }
const sessions = new Map();

// Generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Get or create a session
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

// Clean up empty sessions
function cleanupSession(sessionName) {
    const session = sessions.get(sessionName);
    if (session && !session.sender && session.receivers.size === 0) {
        sessions.delete(sessionName);
        console.log('Deleted empty session:', sessionName);
    }
}

// Send SSE message to a client
function sendSSE(res, data) {
    if (res && !res.finished) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
    }
    return false;
}

// Broadcast to all receivers in a session
function broadcastToReceivers(sessionName, message) {
    const session = sessions.get(sessionName);
    if (!session) return;
    console.log('Broadcasting to receivers in session', sessionName, ':', message.type, 'count:', session.receivers.size);
    session.receivers.forEach((res, id) => {
        if (!sendSSE(res, message)) {
            session.receivers.delete(id);
        }
    });
}

// Send to sender in a session
function sendToSender(sessionName, message) {
    const session = sessions.get(sessionName);
    if (!session) return;
    console.log('Sending to sender in session', sessionName, ':', message.type);
    if (session.senderRes) {
        if (!sendSSE(session.senderRes, message)) {
            session.sender = null;
            session.senderRes = null;
        }
    }
}

// Check if sender is active in a session
function hasSender(sessionName) {
    const session = sessions.get(sessionName);
    return session && session.sender !== null && session.senderRes !== null;
}

// SSE endpoint for sender (with session)
app.get('/api/sse/sender/:session', (req, res) => {
    const sessionName = req.params.session;
    const id = generateId();
    const session = getSession(sessionName);

    // If sender already exists, close old connection (allows page refresh/takeover)
    if (session.sender !== null && session.senderRes !== null) {
        console.log('Replacing existing sender in session', sessionName);
        try {
            // Notify old sender it's being replaced
            sendSSE(session.senderRes, { type: 'replaced', message: 'Another sender connected' });
            session.senderRes.end();
        } catch (e) {
            // Old connection might already be dead
        }
        session.sender = null;
        session.senderRes = null;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    session.sender = id;
    session.senderRes = res;
    console.log('Sender connected to session', sessionName, ':', id);

    // Send registration confirmation
    sendSSE(res, { type: 'registered', role: 'sender' });

    // Notify all receivers in this session that sender is available
    broadcastToReceivers(sessionName, { type: 'sender-available' });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        if (!sendSSE(res, { type: 'heartbeat' })) {
            clearInterval(heartbeat);
        }
    }, 30000);

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
});

// SSE endpoint for receivers (with session)
app.get('/api/sse/receiver/:session', (req, res) => {
    const sessionName = req.params.session;
    const id = generateId();
    const session = getSession(sessionName);

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    session.receivers.set(id, res);
    console.log('Receiver connected to session', sessionName, ':', id, 'total:', session.receivers.size);

    // Send registration confirmation
    sendSSE(res, {
        type: 'registered',
        role: 'receiver',
        receiverId: id,
        senderAvailable: hasSender(sessionName)
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        if (!sendSSE(res, { type: 'heartbeat' })) {
            clearInterval(heartbeat);
            session.receivers.delete(id);
        }
    }, 30000);

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
});

// Message endpoint (replaces WebSocket messages)
app.post('/api/signal', (req, res) => {
    const message = req.body;

    if (!message || !message.type) {
        return res.status(400).json({ error: 'Invalid message' });
    }

    // Extract session from message (required for routing)
    const sessionName = message.session;
    if (!sessionName) {
        return res.status(400).json({ error: 'Session required' });
    }

    // Session name is NEVER forwarded to clients - strip it from the message
    // This keeps session names private (server-side only for routing)
    console.log('Signal received in session', sessionName, ':', message.type, 'from', message.role || 'unknown');

    switch (message.type) {
        case 'request-offer':
            // Receiver is requesting an offer from sender
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'request-offer' });
            }
            break;

        case 'offer':
            // Forward offer from sender to all receivers
            broadcastToReceivers(sessionName, { type: 'offer', offer: message.offer });
            break;

        case 'answer':
            // Forward answer from receiver to sender
            sendToSender(sessionName, { type: 'answer', answer: message.answer });
            break;

        case 'ptt-offer':
            // Forward PTT offer from receiver to sender
            console.log('Forwarding PTT offer to sender in session', sessionName);
            if (hasSender(sessionName)) {
                sendToSender(sessionName, { type: 'ptt-offer', offer: message.offer });
            }
            break;

        case 'ptt-start':
            // Forward PTT start from receiver to sender
            sendToSender(sessionName, { type: 'ptt-start' });
            break;

        case 'ptt-answer':
            // Forward PTT answer from sender to receivers
            broadcastToReceivers(sessionName, { type: 'ptt-answer', answer: message.answer });
            break;

        case 'ptt-stop':
            // Forward PTT stop from receiver to sender
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

        case 'ice-candidate':
            // Forward ICE candidates
            if (message.role === 'sender') {
                broadcastToReceivers(sessionName, { type: 'ice-candidate', candidate: message.candidate });
            } else {
                sendToSender(sessionName, { type: 'ice-candidate', candidate: message.candidate });
            }
            break;

        default:
            console.log('Unknown message type:', message.type);
    }

    res.json({ success: true });
});

// Music API endpoint - supports playlist subdirectories
app.get('/api/music', (req, res) => {
    const mp3Dir = path.join(__dirname, 'mp3');
    const playlist = req.query.playlist || '1'; // Default to playlist 1

    try {
        if (!fs.existsSync(mp3Dir)) {
            return res.json({ files: [], playlists: [], debugTimer: ENABLE_DEBUG_TIMER });
        }

        // Scan for playlist subdirectories (numbered folders like 1/, 2/, etc.)
        const entries = fs.readdirSync(mp3Dir, { withFileTypes: true });
        const playlists = entries
            .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map(entry => {
                const playlistPath = path.join(mp3Dir, entry.name);
                const nameFile = path.join(playlistPath, 'name.txt');
                let displayName = `Playlist ${entry.name}`;

                // Read custom name from name.txt if it exists
                if (fs.existsSync(nameFile)) {
                    try {
                        displayName = fs.readFileSync(nameFile, 'utf8').trim();
                    } catch (e) {
                        // Keep default name on error
                    }
                }

                return { id: entry.name, name: displayName };
            })
            .sort((a, b) => parseInt(a.id) - parseInt(b.id));

        // Get files from the selected playlist folder
        let files = [];
        const playlistDir = path.join(mp3Dir, playlist);

        if (playlists.length > 0 && fs.existsSync(playlistDir)) {
            // Use playlist subdirectory
            files = fs.readdirSync(playlistDir)
                .filter(file => file.toLowerCase().endsWith('.mp3'))
                .map(file => ({
                    name: file.replace(/\.mp3$/i, ''),
                    url: `/mp3/${encodeURIComponent(playlist)}/${encodeURIComponent(file)}`
                }));
        } else if (playlists.length === 0) {
            // Fallback: no subdirectories, use root mp3 folder (backwards compatibility)
            files = entries
                .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.mp3'))
                .map(entry => ({
                    name: entry.name.replace(/\.mp3$/i, ''),
                    url: `/mp3/${encodeURIComponent(entry.name)}`
                }));
        }

        res.json({
            files,
            playlists,
            currentPlaylist: playlists.length > 0 ? playlist : null,
            debugTimer: ENABLE_DEBUG_TIMER
        });
    } catch (err) {
        console.error('Music API error:', err);
        res.json({ files: [], playlists: [], debugTimer: ENABLE_DEBUG_TIMER });
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Landing pages (no session - will show session prompt)
app.get('/sender', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sender.html'));
});

app.get('/receiver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'receiver.html'));
});

// Session URLs - use /s/ and /r/ to avoid conflicts with static files (sender.html, receiver.html)
app.get('/s/:session', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sender.html'));
});

app.get('/r/:session', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'receiver.html'));
});

// API to check status for a specific session
app.get('/api/status/:session', (req, res) => {
    const sessionName = req.params.session;
    const session = sessions.get(sessionName);
    res.json({
        senderActive: session ? (session.sender !== null && session.senderRes !== null) : false,
        receiverCount: session ? session.receivers.size : 0
    });
});

// API to check global status (for landing page)
app.get('/api/status', (req, res) => {
    // Count total active sessions
    let activeSessions = 0;
    let totalReceivers = 0;
    sessions.forEach((session) => {
        if (session.sender !== null) {
            activeSessions++;
        }
        totalReceivers += session.receivers.size;
    });
    res.json({
        activeSessions,
        totalReceivers
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Baby Monitor server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log('Using SSE for signaling (no WebSockets required)');
});

// Wisdom: Audio carries emotion that video cannot capture.
