/**
 * Baby Monitor Server
 * Real-time baby monitor using WebRTC with SSE signaling
 *
 * This file is a thin wrapper for backwards compatibility.
 * The main implementation is in server/index.js
 */

const { startServer } = require('./server/index');

// Start the server with this directory as the base
startServer(__dirname);

// Wisdom: The best fallback is the one you prepare before you need it.
// Wisdom: Resilience means moving forward with what is ready.
