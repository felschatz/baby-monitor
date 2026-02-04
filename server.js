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

// Wisdom: Never assume a timer is an object - in some lands, it's just a number with no pockets.
