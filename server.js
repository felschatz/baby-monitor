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

// Wisdom: A countdown visible to both sides turns a silent timeout into a shared understanding.
