/**
 * Server-side WebRTC relay manager
 * Bridges sender and receiver peer connections so media flows through the server.
 */

let wrtc = null;
let relayLoadError = null;

try {
    wrtc = require('@roamhq/wrtc');
} catch (err) {
    relayLoadError = err?.message || String(err);
    console.error('Server relay unavailable:', relayLoadError);
}

const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
    { urls: 'stun:stun.sipgate.net:3478' }
];

const DEFAULT_ICE_CANDIDATE_POOL_SIZE = 10;

const relaySessions = new Map();
let relayConnectionCounter = 0;

function cloneIceServers() {
    return DEFAULT_ICE_SERVERS.map(server => ({ ...server }));
}

function getRelayPeerConfig() {
    return {
        iceServers: cloneIceServers()
    };
}

function serializeDescription(description) {
    if (!description) return null;
    return {
        type: description.type,
        sdp: description.sdp
    };
}

function serializeCandidate(candidate) {
    if (!candidate) return null;
    return {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment
    };
}

function isRelayAvailable() {
    return Boolean(wrtc && wrtc.RTCPeerConnection);
}

function getRelayError() {
    return relayLoadError;
}

function buildRtcConfig(options = {}) {
    const transport = options.transport === 'relay' ? 'relay' : 'direct';
    const relayAvailable = isRelayAvailable();

    const config = {
        transport,
        relayAvailable,
        iceServers: cloneIceServers(),
        iceCandidatePoolSize: DEFAULT_ICE_CANDIDATE_POOL_SIZE
    };

    if (transport === 'relay' && !relayAvailable) {
        config.error = relayLoadError || 'Server relay is not available on this host.';
    }

    return config;
}

function getRelaySession(sessionName) {
    let relaySession = relaySessions.get(sessionName);
    if (!relaySession) {
        relaySession = {
            connections: new Map()
        };
        relaySessions.set(sessionName, relaySession);
    }
    return relaySession;
}

function cleanupRelaySession(sessionName) {
    const relaySession = relaySessions.get(sessionName);
    if (relaySession && relaySession.connections.size === 0) {
        relaySessions.delete(sessionName);
    }
}

function getRelayConnection(sessionName, receiverId) {
    return relaySessions.get(sessionName)?.connections.get(receiverId) || null;
}

function setRelayConnection(sessionName, receiverId, relayConnection) {
    const relaySession = getRelaySession(sessionName);
    relaySession.connections.set(receiverId, relayConnection);
    return relayConnection;
}

function createEmptyRelayConnection(sessionName, receiverId) {
    return {
        id: ++relayConnectionCounter,
        sessionName,
        receiverId,
        senderPc: null,
        receiverPc: null,
        senderPendingCandidates: [],
        receiverPendingCandidates: [],
        senderPttMid: null,
        senderPttTransceiver: null,
        senderPttSender: null,
        receiverPttTransceiver: null,
        closed: false
    };
}

function ensureRelayConnection(sessionName, receiverId) {
    return getRelayConnection(sessionName, receiverId)
        || setRelayConnection(sessionName, receiverId, createEmptyRelayConnection(sessionName, receiverId));
}

function getSseManager() {
    return require('./sse-manager');
}

function logRelayState(prefix, relayConnection, peerConnection) {
    console.log(
        prefix,
        'session=', relayConnection.sessionName,
        'receiver=', relayConnection.receiverId,
        'state=', peerConnection.connectionState,
        'ice=', peerConnection.iceConnectionState
    );
}

function safeClosePeerConnection(peerConnection) {
    if (!peerConnection) return;
    try {
        peerConnection.close();
    } catch (err) {
        // Ignore close errors
    }
}

function closeRelayConnection(sessionName, receiverId, expectedRelayConnection = null) {
    const relaySession = relaySessions.get(sessionName);
    if (!relaySession) return;

    const relayConnection = relaySession.connections.get(receiverId);
    if (!relayConnection) return;
    if (expectedRelayConnection && relayConnection !== expectedRelayConnection) {
        return;
    }
    if (relayConnection.closed) {
        relaySession.connections.delete(receiverId);
        cleanupRelaySession(sessionName);
        return;
    }

    relayConnection.closed = true;
    relaySession.connections.delete(receiverId);

    safeClosePeerConnection(relayConnection.senderPc);
    safeClosePeerConnection(relayConnection.receiverPc);

    cleanupRelaySession(sessionName);
}

function closeRelaySession(sessionName) {
    const relaySession = relaySessions.get(sessionName);
    if (!relaySession) return;

    const receiverIds = Array.from(relaySession.connections.keys());
    for (const receiverId of receiverIds) {
        closeRelayConnection(sessionName, receiverId);
    }
}

function createManagedPeerConnection(relayConnection, side) {
    const { RTCPeerConnection } = wrtc;
    const peerConnection = new RTCPeerConnection(getRelayPeerConfig());

    peerConnection.onicecandidate = (event) => {
        if (relayConnection.closed || !event.candidate) {
            return;
        }

        const candidate = serializeCandidate(event.candidate);
        const { sendToSender, sendToReceiver } = getSseManager();

        if (side === 'sender') {
            sendToSender(relayConnection.sessionName, {
                type: 'ice-candidate',
                candidate,
                receiverId: relayConnection.receiverId
            });
        } else {
            sendToReceiver(relayConnection.sessionName, relayConnection.receiverId, {
                type: 'ice-candidate',
                candidate
            });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        logRelayState(`Relay ${side} ICE`, relayConnection, peerConnection);
    };

    peerConnection.onconnectionstatechange = () => {
        logRelayState(`Relay ${side}`, relayConnection, peerConnection);
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
            closeRelayConnection(relayConnection.sessionName, relayConnection.receiverId, relayConnection);
        }
    };

    peerConnection.ontrack = (event) => {
        console.log(
            `Relay ${side} track`,
            'session=', relayConnection.sessionName,
            'receiver=', relayConnection.receiverId,
            'kind=', event.track.kind,
            'mid=', event.transceiver?.mid || 'unknown'
        );
    };

    return peerConnection;
}

function getAudioTransceivers(peerConnection) {
    return peerConnection.getTransceivers().filter(transceiver => transceiver.receiver?.track?.kind === 'audio');
}

function findSenderPttTransceiver(peerConnection, senderPttMid) {
    const audioTransceivers = getAudioTransceivers(peerConnection);
    if (senderPttMid) {
        const matched = audioTransceivers.find(transceiver => transceiver.mid === senderPttMid);
        if (matched) {
            return matched;
        }
    }
    return audioTransceivers[audioTransceivers.length - 1] || null;
}

function findInboundMediaTransceiver(peerConnection, kind, excludedMid = null) {
    return peerConnection.getTransceivers().find(transceiver => {
        const track = transceiver.receiver?.track;
        return track
            && track.kind === kind
            && transceiver.mid !== excludedMid;
    }) || null;
}

async function addIceCandidateIfPossible(peerConnection, candidate) {
    if (!peerConnection || !candidate) return;
    try {
        await peerConnection.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    } catch (err) {
        console.log('Relay ICE candidate skipped:', err.message || err);
    }
}

async function flushPendingCandidates(peerConnection, pendingCandidates) {
    for (const candidate of pendingCandidates.splice(0)) {
        await addIceCandidateIfPossible(peerConnection, candidate);
    }
}

async function createReceiverPeer(relayConnection) {
    relayConnection.receiverPc = createManagedPeerConnection(relayConnection, 'receiver');

    const inboundAudio = findInboundMediaTransceiver(
        relayConnection.senderPc,
        'audio',
        relayConnection.senderPttMid
    );
    const inboundVideo = findInboundMediaTransceiver(relayConnection.senderPc, 'video');

    if (inboundAudio?.receiver?.track) {
        const audioTransceiver = relayConnection.receiverPc.addTransceiver('audio', { direction: 'sendonly' });
        await audioTransceiver.sender.replaceTrack(inboundAudio.receiver.track);
    }

    if (inboundVideo?.receiver?.track) {
        const videoTransceiver = relayConnection.receiverPc.addTransceiver('video', { direction: 'sendonly' });
        await videoTransceiver.sender.replaceTrack(inboundVideo.receiver.track);
    }

    relayConnection.receiverPttTransceiver = relayConnection.receiverPc.addTransceiver('audio', { direction: 'recvonly' });

    if (relayConnection.senderPttSender) {
        await relayConnection.senderPttSender.replaceTrack(relayConnection.receiverPttTransceiver.receiver.track);
    }

    return relayConnection.receiverPc;
}

async function createReceiverOffer(relayConnection) {
    if (!relayConnection.receiverPc) {
        await createReceiverPeer(relayConnection);
    }

    const offer = await relayConnection.receiverPc.createOffer();
    await relayConnection.receiverPc.setLocalDescription(offer);

    return {
        offer: serializeDescription(relayConnection.receiverPc.localDescription),
        pttMid: relayConnection.receiverPttTransceiver.mid || null
    };
}

function ensureRelaySupport() {
    if (!isRelayAvailable()) {
        throw new Error(relayLoadError || 'Server relay is not available.');
    }
}

async function handleSenderOffer(sessionName, receiverId, offer, senderPttMid = null) {
    ensureRelaySupport();

    let relayConnection = getRelayConnection(sessionName, receiverId);
    if (!relayConnection || relayConnection.senderPc || relayConnection.receiverPc) {
        closeRelayConnection(sessionName, receiverId, relayConnection);
        relayConnection = setRelayConnection(sessionName, receiverId, createEmptyRelayConnection(sessionName, receiverId));
    }

    relayConnection.senderPttMid = senderPttMid || null;
    relayConnection.senderPc = createManagedPeerConnection(relayConnection, 'sender');

    await relayConnection.senderPc.setRemoteDescription(new wrtc.RTCSessionDescription(offer));
    relayConnection.senderPttTransceiver = findSenderPttTransceiver(relayConnection.senderPc, senderPttMid);
    relayConnection.senderPttSender = relayConnection.senderPttTransceiver?.sender || null;

    if (relayConnection.senderPttTransceiver) {
        relayConnection.senderPttTransceiver.direction = 'sendonly';
    }

    await createReceiverPeer(relayConnection);

    const answer = await relayConnection.senderPc.createAnswer();
    await relayConnection.senderPc.setLocalDescription(answer);
    await flushPendingCandidates(relayConnection.senderPc, relayConnection.senderPendingCandidates);

    const receiverNegotiation = await createReceiverOffer(relayConnection);

    return {
        answer: serializeDescription(relayConnection.senderPc.localDescription),
        receiverOffer: receiverNegotiation.offer,
        receiverPttMid: receiverNegotiation.pttMid
    };
}

async function handleReceiverAnswer(sessionName, receiverId, answer) {
    ensureRelaySupport();

    const relayConnection = getRelayConnection(sessionName, receiverId);
    if (!relayConnection?.receiverPc) {
        throw new Error(`No relay receiver connection for ${receiverId}`);
    }

    await relayConnection.receiverPc.setRemoteDescription(new wrtc.RTCSessionDescription(answer));
    await flushPendingCandidates(relayConnection.receiverPc, relayConnection.receiverPendingCandidates);
}

async function handleSenderIceCandidate(sessionName, receiverId, candidate) {
    const relayConnection = ensureRelayConnection(sessionName, receiverId);
    if (!relayConnection.senderPc || !relayConnection.senderPc.remoteDescription) {
        relayConnection.senderPendingCandidates.push(candidate);
        return;
    }
    await addIceCandidateIfPossible(relayConnection.senderPc, candidate);
}

async function handleReceiverIceCandidate(sessionName, receiverId, candidate) {
    const relayConnection = ensureRelayConnection(sessionName, receiverId);
    if (!relayConnection.receiverPc || !relayConnection.receiverPc.remoteDescription) {
        relayConnection.receiverPendingCandidates.push(candidate);
        return;
    }
    await addIceCandidateIfPossible(relayConnection.receiverPc, candidate);
}

module.exports = {
    buildRtcConfig,
    closeRelayConnection,
    closeRelaySession,
    getRelayError,
    handleReceiverAnswer,
    handleReceiverIceCandidate,
    handleSenderIceCandidate,
    handleSenderOffer,
    isRelayAvailable
};