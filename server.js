const http = require('http');
const path = require('path');
const fs = require('fs');

// Load .env file if it exists (no external dependencies)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        for (const line of envFile.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                if (key && valueParts.length > 0) {
                    process.env[key.trim()] = valueParts.join('=').trim();
                }
            }
        }
    }
} catch (e) {
    // Ignore .env loading errors
}

const ENABLE_DEBUG_TIMER = process.env.ENABLE_DEBUG_TIMER === 'true';

// MIME types for static file serving
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

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
    if (res && !res.writableEnded) {
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

// Parse JSON body from request
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            // Limit body size to 1MB
            if (body.length > 1048576) {
                reject(new Error('Body too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

// Send JSON response
function sendJson(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// Send file response
function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// Match URL pattern with parameters (e.g., /api/sse/sender/:session)
function matchRoute(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
        } else if (patternParts[i] !== pathParts[i]) {
            return null;
        }
    }
    return params;
}

// Setup SSE headers
function setupSSE(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable nginx buffering
    });
}

// Handle SSE sender endpoint
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
}

// Handle SSE receiver endpoint
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
}

// Handle signal endpoint
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

// Handle music API endpoint
function handleMusicApi(res, query) {
    const mp3Dir = path.join(__dirname, 'mp3');
    const playlist = query.playlist || '1';

    try {
        if (!fs.existsSync(mp3Dir)) {
            return sendJson(res, { files: [], playlists: [], debugTimer: ENABLE_DEBUG_TIMER });
        }

        const entries = fs.readdirSync(mp3Dir, { withFileTypes: true });
        const playlists = entries
            .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map(entry => {
                const playlistPath = path.join(mp3Dir, entry.name);
                const nameFile = path.join(playlistPath, 'name.txt');
                let displayName = `Playlist ${entry.name}`;

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

        let files = [];
        const playlistDir = path.join(mp3Dir, playlist);

        if (playlists.length > 0 && fs.existsSync(playlistDir)) {
            files = fs.readdirSync(playlistDir)
                .filter(file => file.toLowerCase().endsWith('.mp3'))
                .map(file => ({
                    name: file.replace(/\.mp3$/i, ''),
                    url: `/mp3/${encodeURIComponent(playlist)}/${encodeURIComponent(file)}`
                }));
        } else if (playlists.length === 0) {
            files = entries
                .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.mp3'))
                .map(entry => ({
                    name: entry.name.replace(/\.mp3$/i, ''),
                    url: `/mp3/${encodeURIComponent(entry.name)}`
                }));
        }

        sendJson(res, {
            files,
            playlists,
            currentPlaylist: playlists.length > 0 ? playlist : null,
            debugTimer: ENABLE_DEBUG_TIMER
        });
    } catch (err) {
        console.error('Music API error:', err);
        sendJson(res, { files: [], playlists: [], debugTimer: ENABLE_DEBUG_TIMER });
    }
}

// Serve static files from a directory
function serveStatic(res, basePath, urlPath) {
    // Decode URL and prevent directory traversal
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(urlPath);
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
    }

    // Normalize and check for directory traversal
    const safePath = path.normalize(decodedPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(basePath, safePath);

    // Ensure the resolved path is within the base directory
    if (!filePath.startsWith(basePath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            return false; // Signal that file wasn't found
        }
        sendFile(res, filePath);
    });

    return true; // Signal that we're handling this request
}

// Main request handler
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams);
    const method = req.method;

    // API Routes
    if (method === 'GET') {
        // SSE sender endpoint
        let params = matchRoute('/api/sse/sender/:session', pathname);
        if (params) {
            return handleSenderSSE(req, res, params.session);
        }

        // SSE receiver endpoint
        params = matchRoute('/api/sse/receiver/:session', pathname);
        if (params) {
            return handleReceiverSSE(req, res, params.session);
        }

        // Session status endpoint
        params = matchRoute('/api/status/:session', pathname);
        if (params) {
            const session = sessions.get(params.session);
            return sendJson(res, {
                senderActive: session ? (session.sender !== null && session.senderRes !== null) : false,
                receiverCount: session ? session.receivers.size : 0
            });
        }

        // Global status endpoint
        if (pathname === '/api/status') {
            let activeSessions = 0;
            let totalReceivers = 0;
            sessions.forEach((session) => {
                if (session.sender !== null) {
                    activeSessions++;
                }
                totalReceivers += session.receivers.size;
            });
            return sendJson(res, { activeSessions, totalReceivers });
        }

        // Music API endpoint
        if (pathname === '/api/music') {
            return handleMusicApi(res, query);
        }

        // Page routes
        if (pathname === '/' || pathname === '/index.html') {
            return sendFile(res, path.join(__dirname, 'public', 'index.html'));
        }

        if (pathname === '/sender' || pathname === '/sender.html') {
            return sendFile(res, path.join(__dirname, 'public', 'sender.html'));
        }

        if (pathname === '/receiver' || pathname === '/receiver.html') {
            return sendFile(res, path.join(__dirname, 'public', 'receiver.html'));
        }

        // Session URLs
        params = matchRoute('/s/:session', pathname);
        if (params) {
            return sendFile(res, path.join(__dirname, 'public', 'sender.html'));
        }

        params = matchRoute('/r/:session', pathname);
        if (params) {
            return sendFile(res, path.join(__dirname, 'public', 'receiver.html'));
        }

        // Static files from /mp3
        if (pathname.startsWith('/mp3/')) {
            const mp3Path = pathname.slice(5); // Remove '/mp3/'
            const filePath = path.join(__dirname, 'mp3', decodeURIComponent(mp3Path));
            const mp3Base = path.join(__dirname, 'mp3');

            // Security: ensure path is within mp3 directory
            const normalizedPath = path.normalize(filePath);
            if (!normalizedPath.startsWith(mp3Base)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end('Forbidden');
                return;
            }

            if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
                return sendFile(res, normalizedPath);
            }
        }

        // Static files from /public
        const publicPath = path.join(__dirname, 'public', pathname);
        const publicBase = path.join(__dirname, 'public');

        // Security: ensure path is within public directory
        const normalizedPublicPath = path.normalize(publicPath);
        if (normalizedPublicPath.startsWith(publicBase) &&
            fs.existsSync(normalizedPublicPath) &&
            fs.statSync(normalizedPublicPath).isFile()) {
            return sendFile(res, normalizedPublicPath);
        }

        // 404 for unmatched GET requests
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    if (method === 'POST') {
        // Signal endpoint
        if (pathname === '/api/signal') {
            return handleSignal(req, res);
        }

        // 404 for unmatched POST requests
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    // Method not allowed
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Baby Monitor server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log('Using SSE for signaling (no WebSockets required)');
    console.log('Zero external dependencies - pure Node.js');
});

// Wisdom: Experimental features are stepping stones to solid solutions.
