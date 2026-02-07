/**
 * Signaling module for WebRTC
 * Handles SSE connection and HTTP POST signaling
 */

/**
 * Create a signaling manager
 * @param {object} options
 * @param {string} options.sessionName - Session name
 * @param {string} options.role - 'sender' or 'receiver'
 * @param {string} options.sseEndpoint - SSE endpoint URL
 * @param {function} options.onMessage - Message handler callback
 * @param {function} [options.onConnect] - Connection callback
 * @param {function} [options.onError] - Error callback
 * @returns {object} Signaling manager
 */
export function createSignalingManager(options) {
    const { sessionName, role, sseEndpoint, onMessage, onConnect, onError } = options;

    let eventSource = null;
    let connected = false;
    let receiverId = null;
    let autoReconnect = true;
    let reconnectTimer = null;

    /**
     * Send signal via HTTP POST
     * @param {object} message
     */
    async function sendSignal(message) {
        message.role = role;
        message.session = sessionName;
        if (receiverId) {
            message.receiverId = receiverId;
        }
        try {
            const response = await fetch('/api/signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message)
            });
            if (!response.ok) {
                console.error('Signal failed:', response.status);
            }
        } catch (err) {
            console.error('Signal error:', err);
        }
    }

    /**
     * Connect to SSE endpoint
     */
    function connect() {
        // Close existing connection
        if (eventSource) {
            eventSource.close();
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        autoReconnect = true;

        const sseUrl = `${sseEndpoint}/${encodeURIComponent(sessionName)}`;
        console.log('Connecting to SSE:', sseUrl);

        eventSource = new EventSource(sseUrl);

        eventSource.onopen = () => {
            console.log('SSE connected');
            connected = true;
            if (onConnect) onConnect();
        };

        eventSource.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            if (message.type !== 'heartbeat') {
                console.log(`${role} received:`, message.type);
            }

            // Track receiver ID
            if (message.type === 'registered' && message.receiverId) {
                receiverId = message.receiverId;
            }

            // Forward to handler
            if (onMessage) {
                await onMessage(message);
            }
        };

        eventSource.onerror = (err) => {
            console.error('SSE error:', err);
            connected = false;
            eventSource.close();
            if (onError) onError(err);
            if (autoReconnect) {
                if (reconnectTimer) clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connect, 3000);
            }
        };
    }

    /**
     * Disconnect SSE
     */
    function disconnect() {
        autoReconnect = false;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        connected = false;
    }

    /**
     * Check if connected
     */
    function isConnected() {
        return connected;
    }

    /**
     * Set connected state (for use by message handlers)
     */
    function setConnected(value) {
        connected = value;
    }

    return {
        sendSignal,
        connect,
        disconnect,
        isConnected,
        setConnected
    };
}
