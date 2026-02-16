/**
 * Adaptive echo cancellation for sender music bleed-through.
 * Uses delayed-reference NLMS instead of analyser-based spectral subtraction.
 */

import { getMicGain } from './mic-gain.js';

const PROCESSOR_BUFFER_SIZE = 2048;
const FILTER_LENGTH = 192;
const DEFAULT_DELAY_MS = 180;
const MIN_DELAY_MS = 20;
const MAX_DELAY_MS = 420;
const DELAY_ESTIMATE_INTERVAL_MS = 1200;
const DELAY_ESTIMATE_WINDOW_SAMPLES = 16384;
const DELAY_SEARCH_STEP = 4;
const DELAY_SEARCH_DECIMATION = 2;
const ADAPT_MU = 0.06;
const ADAPT_EPS = 1e-6;
const WEIGHT_LEAK = 0.9998;
const REFERENCE_ENERGY_FLOOR = 5e-7;
const CORRELATION_FLOOR = 0.02;

let echoCancelEnabled = false;
let echoCancelActive = false;
let musicMediaSource = null;
let musicMediaSourceInitialized = false;
let echoProcessorNode = null;
let echoStreamDestination = null;
let echoGainNode = null;
let echoMicSource = null;
let echoMergeNode = null;
let originalAudioTrack = null;
let processedAudioTrack = null;
let adaptiveState = null;

let audioContext = null;
let getMusicPlaying = null;
let getMusicAudio = null;
let getLocalStream = null;

export function initMusicWebAudio() {
    if (musicMediaSourceInitialized) return;

    const ctx = audioContext?.();
    const musicAudio = getMusicAudio?.();

    if (!ctx || !musicAudio) {
        console.log('Cannot init music WebAudio: missing context or audio element');
        return;
    }

    try {
        musicMediaSource = ctx.createMediaElementSource(musicAudio);
        musicMediaSource.connect(ctx.destination);
        musicMediaSourceInitialized = true;
        console.log('Music audio routed through WebAudio');
    } catch (e) {
        console.log('Music WebAudio init error:', e.message);
    }
}

export function initEchoCancellation(deps) {
    audioContext = deps.getAudioContext;
    getMusicPlaying = deps.getMusicPlaying;
    getMusicAudio = deps.getMusicAudio;
    getLocalStream = deps.getLocalStream;
}

function clampSample(value) {
    if (value > 1) return 1;
    if (value < -1) return -1;
    return value;
}

function wrapIndex(index, size) {
    let wrapped = index % size;
    if (wrapped < 0) wrapped += size;
    return wrapped;
}

function createAdaptiveState(sampleRate) {
    const minDelaySamples = Math.max(1, Math.floor((MIN_DELAY_MS / 1000) * sampleRate));
    const maxDelaySamples = Math.max(minDelaySamples + 1, Math.floor((MAX_DELAY_MS / 1000) * sampleRate));
    const defaultDelaySamples = Math.min(
        maxDelaySamples,
        Math.max(minDelaySamples, Math.floor((DEFAULT_DELAY_MS / 1000) * sampleRate))
    );

    const historySize = Math.max(
        65536,
        maxDelaySamples + FILTER_LENGTH + DELAY_ESTIMATE_WINDOW_SAMPLES + PROCESSOR_BUFFER_SIZE * 4
    );

    return {
        sampleRate,
        minDelaySamples,
        maxDelaySamples,
        delaySamples: defaultDelaySamples,
        historySize,
        refHistory: new Float32Array(historySize),
        micHistory: new Float32Array(historySize),
        historyWritePos: 0,
        totalSamples: 0,
        weights: new Float32Array(FILTER_LENGTH),
        tapBuffer: new Float32Array(FILTER_LENGTH),
        samplesSinceDelayEstimate: 0,
        delayEstimateIntervalSamples: Math.max(
            PROCESSOR_BUFFER_SIZE,
            Math.floor((DELAY_ESTIMATE_INTERVAL_MS / 1000) * sampleRate)
        ),
        correlationScore: 0,
        debugFrames: 0
    };
}

function estimateDelayFromHistory(state) {
    const newestIndex = state.historyWritePos - 1;
    const usableWindow = Math.min(
        DELAY_ESTIMATE_WINDOW_SAMPLES,
        state.totalSamples - state.maxDelaySamples - 1
    );

    if (usableWindow < 2048) {
        return;
    }

    let bestDelay = state.delaySamples;
    let bestScore = -Infinity;

    for (let delay = state.minDelaySamples; delay <= state.maxDelaySamples; delay += DELAY_SEARCH_STEP) {
        let correlation = 0;
        let micEnergy = 0;
        let refEnergy = 0;

        for (let n = 0; n < usableWindow; n += DELAY_SEARCH_DECIMATION) {
            const micIdx = wrapIndex(newestIndex - n, state.historySize);
            const refIdx = wrapIndex(micIdx - delay, state.historySize);
            const mic = state.micHistory[micIdx];
            const ref = state.refHistory[refIdx];

            correlation += mic * ref;
            micEnergy += mic * mic;
            refEnergy += ref * ref;
        }

        if (micEnergy < ADAPT_EPS || refEnergy < ADAPT_EPS) {
            continue;
        }

        const score = correlation / Math.sqrt(micEnergy * refEnergy + ADAPT_EPS);
        if (score > bestScore) {
            bestScore = score;
            bestDelay = delay;
        }
    }

    if (!Number.isFinite(bestScore) || bestScore < CORRELATION_FLOOR) {
        return;
    }

    const previousDelay = state.delaySamples;
    state.delaySamples = Math.round(previousDelay * 0.85 + bestDelay * 0.15);
    state.correlationScore = bestScore;

    if (Math.abs(state.delaySamples - previousDelay) > 8) {
        for (let i = 0; i < state.weights.length; i++) {
            state.weights[i] *= 0.7;
        }
    }

    console.log(
        `Echo cancel delay estimate: ${Math.round((state.delaySamples / state.sampleRate) * 1000)}ms ` +
        `(score=${state.correlationScore.toFixed(3)})`
    );
}

function processAdaptiveSample(state, micSample, refSample, musicPlaying) {
    const writePos = state.historyWritePos;
    state.micHistory[writePos] = micSample;
    state.refHistory[writePos] = refSample;
    state.historyWritePos = (writePos + 1) % state.historySize;
    state.totalSamples += 1;
    state.samplesSinceDelayEstimate += 1;

    if (!musicPlaying) {
        return micSample;
    }

    let tapIdx = wrapIndex(state.historyWritePos - 1 - state.delaySamples, state.historySize);
    let predictedEcho = 0;
    let refEnergy = ADAPT_EPS;

    for (let k = 0; k < FILTER_LENGTH; k++) {
        const ref = state.refHistory[tapIdx];
        state.tapBuffer[k] = ref;
        predictedEcho += state.weights[k] * ref;
        refEnergy += ref * ref;
        tapIdx -= 1;
        if (tapIdx < 0) tapIdx = state.historySize - 1;
    }

    const error = micSample - predictedEcho;

    if (refEnergy > REFERENCE_ENERGY_FLOOR) {
        const mu = ADAPT_MU / refEnergy;
        for (let k = 0; k < FILTER_LENGTH; k++) {
            state.weights[k] = state.weights[k] * WEIGHT_LEAK + mu * error * state.tapBuffer[k];
        }
    }

    return clampSample(error);
}

function ensureMusicSource(ctx, musicAudio) {
    if (!musicMediaSource) {
        musicMediaSource = ctx.createMediaElementSource(musicAudio);
        musicMediaSourceInitialized = true;
    }

    try {
        musicMediaSource.disconnect();
    } catch (e) {}

    musicMediaSource.connect(ctx.destination);
}

export function setupEchoCancellation() {
    const ctx = audioContext?.();
    const localStream = getLocalStream?.();
    const musicAudio = getMusicAudio?.();

    if (!ctx || !localStream || !musicAudio) {
        console.log('Echo cancel: missing context, stream, or music audio element');
        return false;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) {
        console.log('Echo cancel: no audio track');
        return false;
    }

    if (echoCancelActive) {
        if (processedAudioTrack && originalAudioTrack && originalAudioTrack.id === audioTrack.id) {
            console.log('Echo cancel already active for current audio track');
            return true;
        }
        console.log('Echo cancel active with different source track, rebuilding');
        teardownEchoCancellation();
    }

    try {
        originalAudioTrack = audioTrack;
        adaptiveState = createAdaptiveState(ctx.sampleRate);

        ensureMusicSource(ctx, musicAudio);

        echoMicSource = ctx.createMediaStreamSource(localStream);
        echoMergeNode = ctx.createChannelMerger(2);
        echoProcessorNode = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 2, 1);
        echoGainNode = ctx.createGain();
        echoGainNode.gain.value = getMicGain();
        echoStreamDestination = ctx.createMediaStreamDestination();

        echoMicSource.connect(echoMergeNode, 0, 0);
        musicMediaSource.connect(echoMergeNode, 0, 1);
        echoMergeNode.connect(echoProcessorNode);
        echoProcessorNode.connect(echoGainNode);
        echoGainNode.connect(echoStreamDestination);

        echoProcessorNode.onaudioprocess = (event) => {
            if (!adaptiveState) return;

            const micData = event.inputBuffer.getChannelData(0);
            const refData = event.inputBuffer.numberOfChannels > 1
                ? event.inputBuffer.getChannelData(1)
                : null;
            const outData = event.outputBuffer.getChannelData(0);
            const musicPlaying = !!getMusicPlaying?.();

            for (let i = 0; i < micData.length; i++) {
                const ref = refData ? refData[i] : 0;
                outData[i] = processAdaptiveSample(adaptiveState, micData[i], ref, musicPlaying);
            }

            if (musicPlaying && adaptiveState.samplesSinceDelayEstimate >= adaptiveState.delayEstimateIntervalSamples) {
                adaptiveState.samplesSinceDelayEstimate = 0;
                estimateDelayFromHistory(adaptiveState);
            }

            adaptiveState.debugFrames += 1;
            if (adaptiveState.debugFrames % 50 === 1) {
                console.log(
                    'Echo cancel active:',
                    `delay=${Math.round((adaptiveState.delaySamples / adaptiveState.sampleRate) * 1000)}ms`,
                    `corr=${adaptiveState.correlationScore.toFixed(3)}`
                );
            }
        };

        processedAudioTrack = echoStreamDestination.stream.getAudioTracks()[0] || null;
        if (!processedAudioTrack) {
            throw new Error('No processed audio track produced');
        }

        echoCancelActive = true;
        console.log('Adaptive echo cancellation setup complete');
        return true;
    } catch (err) {
        console.error('Echo cancellation setup error:', err);
        teardownEchoCancellation();
        return false;
    }
}

export function teardownEchoCancellation() {
    console.log('Tearing down echo cancellation...');

    if (echoProcessorNode) {
        echoProcessorNode.onaudioprocess = null;
        try { echoProcessorNode.disconnect(); } catch (e) {}
        echoProcessorNode = null;
    }

    if (echoGainNode) {
        try { echoGainNode.disconnect(); } catch (e) {}
        echoGainNode = null;
    }

    if (echoMergeNode) {
        try { echoMergeNode.disconnect(); } catch (e) {}
        echoMergeNode = null;
    }

    if (echoMicSource) {
        try { echoMicSource.disconnect(); } catch (e) {}
        echoMicSource = null;
    }

    if (musicMediaSource) {
        const ctx = audioContext?.();
        if (ctx) {
            try {
                musicMediaSource.disconnect();
            } catch (e) {}
            musicMediaSource.connect(ctx.destination);
        }
    }

    echoStreamDestination = null;
    adaptiveState = null;
    processedAudioTrack = null;
    echoCancelActive = false;

    console.log('Echo cancellation teardown complete');
}

export function isEchoCancelEnabled() { return echoCancelEnabled; }
export function isEchoCancelActive() { return echoCancelActive; }
export function setEchoCancelEnabled(value) { echoCancelEnabled = value; }
export function getOriginalAudioTrack() { return originalAudioTrack; }
export function getProcessedAudioTrack() { return processedAudioTrack; }
export function getMusicMediaSource() { return musicMediaSource; }
export function isMusicWebAudioInitialized() { return musicMediaSourceInitialized; }
