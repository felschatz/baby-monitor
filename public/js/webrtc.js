/**
 * WebRTC utilities and configuration
 * Shared between sender and receiver
 */

/**
 * Default WebRTC configuration with public STUN servers
 * (only used for IP discovery, no media passes through)
 */
export const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.stunprotocol.org:3478' },
        { urls: 'stun:stun.nextcloud.com:443' },
        { urls: 'stun:stun.sipgate.net:3478' }
    ],
    iceCandidatePoolSize: 10
};

/**
 * Create a new RTCPeerConnection with default configuration
 * @param {object} [config] - Optional custom configuration
 * @returns {RTCPeerConnection}
 */
export function createPeerConnection(config = rtcConfig) {
    return new RTCPeerConnection(config);
}

/**
 * Wait for peer connection to reach stable state
 * @param {RTCPeerConnection} pc
 * @returns {Promise<void>}
 */
export async function waitForStableState(pc) {
    if (pc.signalingState === 'stable') {
        return;
    }

    return new Promise((resolve) => {
        const checkState = () => {
            if (pc.signalingState === 'stable') {
                resolve();
            } else {
                setTimeout(checkState, 100);
            }
        };
        checkState();
    });
}

/**
 * Add ICE candidates to peer connection with error handling
 * @param {RTCPeerConnection} pc
 * @param {Array} candidates - Array of ICE candidates
 */
export async function addIceCandidates(pc, candidates) {
    for (const candidate of candidates) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.log('ICE candidate error:', err.message);
        }
    }
}

/**
 * Get video constraints based on quality setting
 * @param {string} quality - 'sd' or 'hd'
 * @returns {object}
 */
export function getVideoConstraints(quality = 'hd') {
    if (quality === 'sd') {
        return { width: { ideal: 640 }, height: { ideal: 480 } };
    }
    return { width: { ideal: 1280 }, height: { ideal: 720 } };
}

/**
 * Get media constraints for sender
 * @param {object} options
 * @param {boolean} options.video - Enable video
 * @param {boolean} options.audio - Enable audio
 * @param {string} [options.quality] - Video quality 'sd' or 'hd'
 * @returns {MediaStreamConstraints}
 */
export function getMediaConstraints(options) {
    const { video, audio, quality = 'hd' } = options;

    return {
        video: video ? {
            facingMode: 'environment',
            ...getVideoConstraints(quality)
        } : false,
        audio: audio ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        } : false
    };
}
