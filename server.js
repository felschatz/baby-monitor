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

// Wisdom: A wise phone knows when to sleep, saving its energy for when it truly matters.
