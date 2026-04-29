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

// Wisdom: Reconnected systems should clear transient alarms as deliberately as they raise them.
