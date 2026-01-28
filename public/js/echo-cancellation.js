/**
 * Echo Cancellation using FFT-based Spectral Subtraction
 * Reduces music echo from the baby's microphone
 */

// FFT-based spectral subtraction parameters
const FFT_SIZE = 2048;              // Frequency resolution (1024 bins)
const HOP_SIZE = 1024;              // 50% overlap
const ALPHA = 2.0;                  // Over-subtraction factor (reduces musical noise)
const BETA = 0.02;                  // Spectral floor (prevents artifacts)
const SMOOTHING = 0.6;              // Temporal smoothing between frames
const MUSIC_SCALE = 0.7;            // Scale music magnitude for acoustic path
const PROCESSOR_BUFFER_SIZE = 4096; // Processing buffer size
const MAX_OVERRUNS = 10;            // Fallback to simple mode after this many

// State
let echoCancelEnabled = false;
let echoCancelActive = false;
let musicMediaSource = null;
let echoProcessorNode = null;
let echoStreamDestination = null;
let echoMicSource = null;
let echoMusicAnalyser = null;
let originalAudioTrack = null;
let processedAudioTrack = null;
let fftState = null;

// External dependencies (set via init)
let audioContext = null;
let getMusicPlaying = null;
let getMusicAudio = null;
let getLocalStream = null;

/**
 * Initialize echo cancellation module
 * @param {object} deps
 * @param {function} deps.getAudioContext - Function returning AudioContext
 * @param {function} deps.getMusicPlaying - Function returning music playing state
 * @param {function} deps.getMusicAudio - Function returning music audio element
 * @param {function} deps.getLocalStream - Function returning local media stream
 */
export function initEchoCancellation(deps) {
    audioContext = deps.getAudioContext;
    getMusicPlaying = deps.getMusicPlaying;
    getMusicAudio = deps.getMusicAudio;
    getLocalStream = deps.getLocalStream;
}

// === FFT Implementation (Radix-2 Cooley-Tukey) ===

function bitReverse(n, bits) {
    let reversed = 0;
    for (let i = 0; i < bits; i++) {
        reversed = (reversed << 1) | (n & 1);
        n >>= 1;
    }
    return reversed;
}

function fftInPlace(real, imag) {
    const n = real.length;
    const bits = Math.log2(n);

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
        const j = bitReverse(i, bits);
        if (j > i) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }

    // Cooley-Tukey iterative FFT
    for (let size = 2; size <= n; size *= 2) {
        const halfSize = size / 2;
        const angleStep = -2 * Math.PI / size;

        for (let i = 0; i < n; i += size) {
            for (let j = 0; j < halfSize; j++) {
                const angle = angleStep * j;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                const evenIdx = i + j;
                const oddIdx = i + j + halfSize;

                const tReal = cos * real[oddIdx] - sin * imag[oddIdx];
                const tImag = sin * real[oddIdx] + cos * imag[oddIdx];

                real[oddIdx] = real[evenIdx] - tReal;
                imag[oddIdx] = imag[evenIdx] - tImag;
                real[evenIdx] = real[evenIdx] + tReal;
                imag[evenIdx] = imag[evenIdx] + tImag;
            }
        }
    }
}

function ifftInPlace(real, imag) {
    const n = real.length;

    // Conjugate
    for (let i = 0; i < n; i++) {
        imag[i] = -imag[i];
    }

    // Forward FFT
    fftInPlace(real, imag);

    // Conjugate and scale
    for (let i = 0; i < n; i++) {
        real[i] = real[i] / n;
        imag[i] = -imag[i] / n;
    }
}

function createHannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / size));
    }
    return window;
}

function initFFTState() {
    const hannWindow = createHannWindow(FFT_SIZE);

    return {
        hannWindow,
        inputRing: new Float32Array(FFT_SIZE),
        outputRing: new Float32Array(FFT_SIZE * 2),
        inputPos: 0,
        outputReadPos: 0,
        outputWritePos: FFT_SIZE,
        totalSamplesIn: 0,
        fftReal: new Float32Array(FFT_SIZE),
        fftImag: new Float32Array(FFT_SIZE),
        musicFreqData: null,
        prevMag: new Float32Array(FFT_SIZE / 2 + 1),
        overrunCount: 0,
        useSimpleMode: false,
        lastProcessTime: 0
    };
}

// === Processing Functions ===

function processFFTFrame() {
    const state = fftState;

    // Copy input with Hann windowing
    for (let i = 0; i < FFT_SIZE; i++) {
        const idx = (state.inputPos + i) % FFT_SIZE;
        state.fftReal[i] = state.inputRing[idx] * state.hannWindow[i];
        state.fftImag[i] = 0;
    }

    // Forward FFT
    fftInPlace(state.fftReal, state.fftImag);

    // Spectral subtraction per frequency bin
    const numBins = FFT_SIZE / 2 + 1;
    const musicBins = state.musicFreqData.length;

    for (let k = 0; k < numBins; k++) {
        const micMag = Math.sqrt(state.fftReal[k] * state.fftReal[k] + state.fftImag[k] * state.fftImag[k]);
        const phase = Math.atan2(state.fftImag[k], state.fftReal[k]);

        const musicIdx = Math.min(k, musicBins - 1);
        const musicDb = state.musicFreqData[musicIdx];
        const musicMag = Math.pow(10, musicDb / 20) * MUSIC_SCALE;

        let outputMag = micMag - ALPHA * musicMag;
        outputMag = Math.max(outputMag, BETA * micMag);

        outputMag = SMOOTHING * state.prevMag[k] + (1 - SMOOTHING) * outputMag;
        state.prevMag[k] = outputMag;

        state.fftReal[k] = outputMag * Math.cos(phase);
        state.fftImag[k] = outputMag * Math.sin(phase);

        if (k > 0 && k < FFT_SIZE / 2) {
            state.fftReal[FFT_SIZE - k] = state.fftReal[k];
            state.fftImag[FFT_SIZE - k] = -state.fftImag[k];
        }
    }

    // Inverse FFT
    ifftInPlace(state.fftReal, state.fftImag);

    // Overlap-add to output buffer
    for (let i = 0; i < FFT_SIZE; i++) {
        const outIdx = (state.outputWritePos + i) % (FFT_SIZE * 2);
        state.outputRing[outIdx] += state.fftReal[i] * state.hannWindow[i];
    }

    state.outputWritePos = (state.outputWritePos + HOP_SIZE) % (FFT_SIZE * 2);
}

function processSimpleMode(inputData, outputData) {
    echoMusicAnalyser.getFloatFrequencyData(fftState.musicFreqData);

    let musicEnergy = 0;
    for (let i = 0; i < fftState.musicFreqData.length; i++) {
        const linear = Math.pow(10, fftState.musicFreqData[i] / 20);
        musicEnergy += linear;
    }
    musicEnergy = musicEnergy / fftState.musicFreqData.length;

    const suppressionFactor = Math.min(1, musicEnergy * 7);

    for (let i = 0; i < inputData.length; i++) {
        outputData[i] = inputData[i] * (1 - suppressionFactor * 0.7);
    }
}

// === Public API ===

/**
 * Setup echo cancellation audio processing pipeline
 * @returns {boolean} Whether setup was successful
 */
export function setupEchoCancellation() {
    const ctx = audioContext();
    const localStream = getLocalStream();
    const musicAudio = getMusicAudio();

    if (!localStream || !ctx) {
        console.log('Echo cancel: no stream or audio context');
        return false;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) {
        console.log('Echo cancel: no audio track');
        return false;
    }

    try {
        console.log('Setting up FFT-based echo cancellation...');

        originalAudioTrack = audioTrack;
        fftState = initFFTState();

        echoMusicAnalyser = ctx.createAnalyser();
        echoMusicAnalyser.fftSize = FFT_SIZE;
        echoMusicAnalyser.smoothingTimeConstant = 0.3;

        fftState.musicFreqData = new Float32Array(echoMusicAnalyser.frequencyBinCount);

        echoMicSource = ctx.createMediaStreamSource(localStream);

        if (!musicMediaSource) {
            musicMediaSource = ctx.createMediaElementSource(musicAudio);
        }
        try {
            musicMediaSource.disconnect();
        } catch (e) {}
        musicMediaSource.connect(ctx.destination);
        musicMediaSource.connect(echoMusicAnalyser);

        echoProcessorNode = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
        echoStreamDestination = ctx.createMediaStreamDestination();

        echoMicSource.connect(echoProcessorNode);
        echoProcessorNode.connect(echoStreamDestination);

        let debugCounter = 0;

        echoProcessorNode.onaudioprocess = (e) => {
            const startTime = performance.now();
            const inputData = e.inputBuffer.getChannelData(0);
            const outputData = e.outputBuffer.getChannelData(0);
            const bufferSize = inputData.length;

            debugCounter++;
            if (debugCounter % 24 === 1) {
                let inputRms = 0;
                for (let j = 0; j < bufferSize; j++) {
                    inputRms += inputData[j] * inputData[j];
                }
                inputRms = Math.sqrt(inputRms / bufferSize);
                console.log(`Echo cancel debug: musicPlaying=${getMusicPlaying()}, inputRms=${inputRms.toFixed(6)}, totalSamples=${fftState?.totalSamplesIn || 0}`);
            }

            if (!getMusicPlaying()) {
                for (let i = 0; i < bufferSize; i++) {
                    outputData[i] = inputData[i];
                }
                return;
            }

            if (fftState.useSimpleMode) {
                processSimpleMode(inputData, outputData);
                return;
            }

            echoMusicAnalyser.getFloatFrequencyData(fftState.musicFreqData);

            for (let i = 0; i < bufferSize; i++) {
                fftState.inputRing[fftState.inputPos] = inputData[i];
                fftState.inputPos = (fftState.inputPos + 1) % FFT_SIZE;
                fftState.totalSamplesIn++;

                if (fftState.totalSamplesIn >= FFT_SIZE &&
                    (fftState.totalSamplesIn - FFT_SIZE) % HOP_SIZE === 0) {
                    processFFTFrame();
                }

                outputData[i] = fftState.outputRing[fftState.outputReadPos];
                fftState.outputRing[fftState.outputReadPos] = 0;
                fftState.outputReadPos = (fftState.outputReadPos + 1) % (FFT_SIZE * 2);
            }

            if (debugCounter % 24 === 1) {
                let outputRms = 0;
                for (let j = 0; j < bufferSize; j++) {
                    outputRms += outputData[j] * outputData[j];
                }
                outputRms = Math.sqrt(outputRms / bufferSize);
                console.log(`Echo cancel output: outputRms=${outputRms.toFixed(6)}, framesProcessed=${Math.floor((fftState.totalSamplesIn - FFT_SIZE) / HOP_SIZE) + 1}`);
            }

            const processTime = performance.now() - startTime;
            const budgetMs = (bufferSize / ctx.sampleRate) * 1000;

            if (processTime > budgetMs * 0.8) {
                fftState.overrunCount++;
                console.warn(`Echo cancel: processing took ${processTime.toFixed(1)}ms (budget: ${budgetMs.toFixed(1)}ms), overruns: ${fftState.overrunCount}`);

                if (fftState.overrunCount >= MAX_OVERRUNS) {
                    console.warn('Echo cancel: switching to simple mode due to performance');
                    fftState.useSimpleMode = true;
                }
            }
        };

        processedAudioTrack = echoStreamDestination.stream.getAudioTracks()[0];

        echoCancelActive = true;
        console.log('FFT-based echo cancellation setup complete');
        return true;

    } catch (err) {
        console.error('Echo cancellation setup error:', err);
        teardownEchoCancellation();
        return false;
    }
}

/**
 * Teardown echo cancellation
 */
export function teardownEchoCancellation() {
    console.log('Tearing down echo cancellation...');

    if (echoProcessorNode) {
        echoProcessorNode.disconnect();
        echoProcessorNode.onaudioprocess = null;
        echoProcessorNode = null;
    }

    if (echoMicSource) {
        echoMicSource.disconnect();
        echoMicSource = null;
    }

    if (echoMusicAnalyser) {
        echoMusicAnalyser.disconnect();
        echoMusicAnalyser = null;
    }

    if (echoStreamDestination) {
        echoStreamDestination = null;
    }

    fftState = null;
    processedAudioTrack = null;
    echoCancelActive = false;
    console.log('Echo cancellation teardown complete');
}

/**
 * Get state
 */
export function isEchoCancelEnabled() { return echoCancelEnabled; }
export function isEchoCancelActive() { return echoCancelActive; }
export function setEchoCancelEnabled(value) { echoCancelEnabled = value; }
export function getOriginalAudioTrack() { return originalAudioTrack; }
export function getProcessedAudioTrack() { return processedAudioTrack; }
export function getMusicMediaSource() { return musicMediaSource; }
