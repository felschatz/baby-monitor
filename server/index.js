/**
 * Baby Monitor Server - Main entry point
 * Real-time baby monitor using WebRTC with SSE signaling
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const { matchRoute, sendJson } = require('./utils');
const { getAllSessions } = require('./session-manager');
const { handleSenderSSE, handleReceiverSSE } = require('./sse-manager');
const { handleSignal } = require('./signal-router');
const { handleMusicApi } = require('./music-api');
const { sendFile, serveMp3, servePublic } = require('./static-server');

/**
 * Load .env file if it exists (no external dependencies)
 * @param {string} baseDir - Base directory of the application
 * @returns {object} Environment configuration
 */
function loadEnv(baseDir) {
    try {
        const envPath = path.join(baseDir, '.env');
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

    return {
        ENABLE_DEBUG_TIMER: process.env.ENABLE_DEBUG_TIMER === 'true',
        PORT: process.env.PORT || 3000
    };
}

/**
 * Create and configure the HTTP server
 * @param {string} baseDir - Base directory of the application
 * @returns {http.Server}
 */
function createServer(baseDir) {
    const config = loadEnv(baseDir);

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
                const sessions = getAllSessions();
                const session = sessions.get(params.session);
                return sendJson(res, {
                    senderActive: session ? (session.sender !== null && session.senderRes !== null) : false,
                    receiverCount: session ? session.receivers.size : 0
                });
            }

            // Global status endpoint
            if (pathname === '/api/status') {
                const sessions = getAllSessions();
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
                return handleMusicApi(res, query, baseDir, config.ENABLE_DEBUG_TIMER);
            }

            // Page routes
            if (pathname === '/' || pathname === '/index.html') {
                return sendFile(res, path.join(baseDir, 'public', 'index.html'));
            }

            if (pathname === '/sender' || pathname === '/sender.html') {
                return sendFile(res, path.join(baseDir, 'public', 'sender.html'));
            }

            if (pathname === '/receiver' || pathname === '/receiver.html') {
                return sendFile(res, path.join(baseDir, 'public', 'receiver.html'));
            }

            // Session URLs
            params = matchRoute('/s/:session', pathname);
            if (params) {
                return sendFile(res, path.join(baseDir, 'public', 'sender.html'));
            }

            params = matchRoute('/r/:session', pathname);
            if (params) {
                return sendFile(res, path.join(baseDir, 'public', 'receiver.html'));
            }

            // Static files from /mp3
            if (serveMp3(res, pathname, baseDir)) {
                return;
            }

            // Static files from /public
            if (servePublic(res, pathname, baseDir)) {
                return;
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

    return { server, config };
}

/**
 * Start the server
 * @param {string} baseDir - Base directory of the application
 */
function startServer(baseDir) {
    const { server, config } = createServer(baseDir);

    server.listen(config.PORT, () => {
        console.log(`Baby Monitor server running on port ${config.PORT}`);
        console.log(`Open http://localhost:${config.PORT} in your browser`);
        console.log('Using SSE for signaling (no WebSockets required)');
        console.log('Zero external dependencies - pure Node.js');
    });

    return server;
}

module.exports = {
    loadEnv,
    createServer,
    startServer
};

// Run if executed directly
if (require.main === module) {
    startServer(__dirname.replace(/[\/\\]server$/, ''));
}
