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
const DEFAULT_DELAY_MS = 250;       // Initial delay estimate for speaker→mic path
const MIN_DELAY_MS = 50;            // Minimum plausible delay
const MAX_DELAY_MS = 500;           // Maximum plausible delay
const CALIBRATION_DURATION_MS = 3000; // Duration of auto-calibration phase

// State
let echoCancelEnabled = false;
let echoCancelActive = false;
let musicMediaSource = null;
let musicMediaSourceInitialized = false;
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
 * Initialize music audio routing through Web Audio API
 * Call this when music first starts to ensure consistent audio path
 */
export function initMusicWebAudio() {
    if (musicMediaSourceInitialized) return;

    const ctx = audioContext?.();
    const musicAudio = getMusicAudio?.();

    if (!ctx || !musicAudio) {
        console.log('Cannot init music Web Audio: missing context or audio element');
        return;
    }

    try {
        if (!musicMediaSource) {
            musicMediaSource = ctx.createMediaElementSource(musicAudio);
            musicMediaSource.connect(ctx.destination);
            musicMediaSourceInitialized = true;
            console.log('Music audio routed through Web Audio API');
        }
    } catch (e) {
        console.log('Music Web Audio init error:', e.message);
    }
}

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

function initFFTState(sampleRate) {
    const hannWindow = createHannWindow(FFT_SIZE);

    // Calculate delay parameters
    const framesPerSecond = sampleRate / HOP_SIZE;
    const msPerFrame = 1000 / framesPerSecond;
    const maxDelayFrames = Math.ceil((MAX_DELAY_MS / 1000) * framesPerSecond);
    const numBins = FFT_SIZE / 2 + 1;

    // Calibration buffers - store time-domain samples for cross-correlation
    const calibrationSamples = Math.ceil((CALIBRATION_DURATION_MS / 1000) * sampleRate);
    const maxDelaySamples = Math.ceil((MAX_DELAY_MS / 1000) * sampleRate);

    return {
        hannWindow,
        sampleRate,
        framesPerSecond,
        msPerFrame,
        inputRing: new Float32Array(FFT_SIZE),
        outputRing: new Float32Array(FFT_SIZE * 2),
        inputPos: 0,
        outputReadPos: 0,
        outputWritePos: FFT_SIZE,
        totalSamplesIn: 0,
        fftReal: new Float32Array(FFT_SIZE),
        fftImag: new Float32Array(FFT_SIZE),
        musicFreqData: null,
        prevMag: new Float32Array(numBins),
        overrunCount: 0,
        useSimpleMode: false,
        lastProcessTime: 0,
        // Delay compensation - use max delay for buffer size, actual delay is dynamic
        delayFrames: Math.ceil((DEFAULT_DELAY_MS / 1000) * framesPerSecond),
        maxDelayFrames,
        musicHistoryBuffer: new Array(maxDelayFrames + 1).fill(null).map(() => new Float32Array(numBins)),
        musicHistoryWritePos: 0,
        musicHistoryFilled: false,
        // Auto-calibration state
        calibrating: true,
        calibrationStartTime: 0,
        calibrationMicBuffer: new Float32Array(calibrationSamples),
        calibrationMusicBuffer: new Float32Array(calibrationSamples),
        calibrationPos: 0,
        calibrationSamples,
        maxDelaySamples,
        detectedDelayMs: DEFAULT_DELAY_MS
    };
}

// === Delay Detection via Cross-Correlation ===

/**
 * Compute cross-correlation to find delay between music and mic signals.
 * Returns the delay in samples that maximizes correlation.
 */
function detectDelay(musicBuffer, micBuffer, maxDelaySamples, sampleRate) {
    const minDelay = Math.floor((MIN_DELAY_MS / 1000) * sampleRate);
    const maxDelay = Math.min(maxDelaySamples, Math.floor((MAX_DELAY_MS / 1000) * sampleRate));
    const len = musicBuffer.length;

    // Downsample for faster computation (every 4th sample)
    const step = 4;
    let bestCorrelation = -Infinity;
    let bestDelay = Math.floor((DEFAULT_DELAY_MS / 1000) * sampleRate);

    for (let delay = minDelay; delay <= maxDelay; delay += step) {
        let correlation = 0;
        let count = 0;

        // Correlate music[i] with mic[i + delay]
        for (let i = 0; i < len - delay; i += step) {
            correlation += musicBuffer[i] * micBuffer[i + delay];
            count++;
        }

        if (count > 0) {
            correlation /= count;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestDelay = delay;
            }
        }
    }

    // Refine around best delay with finer resolution
    const refineStart = Math.max(minDelay, bestDelay - step * 2);
    const refineEnd = Math.min(maxDelay, bestDelay + step * 2);

    for (let delay = refineStart; delay <= refineEnd; delay++) {
        let correlation = 0;
        let count = 0;

        for (let i = 0; i < len - delay; i += step) {
            correlation += musicBuffer[i] * micBuffer[i + delay];
            count++;
        }

        if (count > 0) {
            correlation /= count;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestDelay = delay;
            }
        }
    }

    return { delaySamples: bestDelay, correlation: bestCorrelation };
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
        fftState = initFFTState(ctx.sampleRate);
        console.log(`Echo cancel: initial delay = ${fftState.delayFrames} frames (${DEFAULT_DELAY_MS}ms at ${ctx.sampleRate}Hz), auto-calibrating...`);

        echoMusicAnalyser = ctx.createAnalyser();
        echoMusicAnalyser.fftSize = FFT_SIZE;
        echoMusicAnalyser.smoothingTimeConstant = 0.3;

        fftState.musicFreqData = new Float32Array(echoMusicAnalyser.frequencyBinCount);
        fftState.musicTimeDomainData = new Float32Array(echoMusicAnalyser.fftSize);

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
                const calibStatus = fftState?.calibrating ? `calibrating (${fftState.calibrationPos}/${fftState.calibrationSamples})` : `delay=${fftState?.detectedDelayMs?.toFixed(0)}ms`;
                console.log(`Echo cancel: ${calibStatus}, inputRms=${inputRms.toFixed(6)}`);
            }

            if (!getMusicPlaying()) {
                for (let i = 0; i < bufferSize; i++) {
                    outputData[i] = inputData[i];
                }
                // Reset calibration if music stopped
                if (fftState.calibrating) {
                    fftState.calibrationPos = 0;
                    fftState.calibrationStartTime = 0;
                }
                return;
            }

            if (fftState.useSimpleMode) {
                processSimpleMode(inputData, outputData);
                return;
            }

            // Get current music data (frequency + time domain for calibration)
            echoMusicAnalyser.getFloatFrequencyData(fftState.musicFreqData);

            // During calibration, collect time-domain samples for cross-correlation
            if (fftState.calibrating) {
                if (fftState.calibrationStartTime === 0) {
                    fftState.calibrationStartTime = performance.now();
                }

                // Get music time-domain data
                echoMusicAnalyser.getFloatTimeDomainData(fftState.musicTimeDomainData);

                // Store samples for correlation
                const samplesToStore = Math.min(bufferSize, fftState.calibrationSamples - fftState.calibrationPos);
                for (let i = 0; i < samplesToStore; i++) {
                    const pos = fftState.calibrationPos + i;
                    // Use center of time-domain buffer for music
                    const musicIdx = Math.floor(i * fftState.musicTimeDomainData.length / bufferSize);
                    fftState.calibrationMusicBuffer[pos] = fftState.musicTimeDomainData[musicIdx];
                    fftState.calibrationMicBuffer[pos] = inputData[i];
                }
                fftState.calibrationPos += samplesToStore;

                // Check if calibration is complete
                const elapsed = performance.now() - fftState.calibrationStartTime;
                if (elapsed >= CALIBRATION_DURATION_MS && fftState.calibrationPos >= fftState.maxDelaySamples * 2) {
                    // Run delay detection
                    const result = detectDelay(
                        fftState.calibrationMusicBuffer,
                        fftState.calibrationMicBuffer,
                        fftState.maxDelaySamples,
                        fftState.sampleRate
                    );

                    const detectedMs = (result.delaySamples / fftState.sampleRate) * 1000;
                    fftState.detectedDelayMs = detectedMs;
                    fftState.delayFrames = Math.ceil((detectedMs / 1000) * fftState.framesPerSecond);
                    fftState.calibrating = false;

                    console.log(`Echo cancel: auto-detected delay = ${detectedMs.toFixed(0)}ms (${fftState.delayFrames} frames), correlation = ${result.correlation.toFixed(6)}`);

                    // Clear calibration buffers to free memory
                    fftState.calibrationMusicBuffer = null;
                    fftState.calibrationMicBuffer = null;
                }
            }

            for (let i = 0; i < bufferSize; i++) {
                fftState.inputRing[fftState.inputPos] = inputData[i];
                fftState.inputPos = (fftState.inputPos + 1) % FFT_SIZE;
                fftState.totalSamplesIn++;

                if (fftState.totalSamplesIn >= FFT_SIZE &&
                    (fftState.totalSamplesIn - FFT_SIZE) % HOP_SIZE === 0) {
                    // Store current music data in history buffer
                    const historyBuf = fftState.musicHistoryBuffer[fftState.musicHistoryWritePos];
                    for (let k = 0; k < fftState.musicFreqData.length; k++) {
                        historyBuf[k] = fftState.musicFreqData[k];
                    }

                    // Read delayed music data for subtraction
                    const bufferLen = fftState.musicHistoryBuffer.length;
                    const delayedPos = (fftState.musicHistoryWritePos - fftState.delayFrames + bufferLen) % bufferLen;
                    const delayedMusic = fftState.musicHistoryBuffer[delayedPos];

                    // Copy delayed data to musicFreqData for processFFTFrame
                    for (let k = 0; k < fftState.musicFreqData.length; k++) {
                        fftState.musicFreqData[k] = delayedMusic[k];
                    }

                    // Advance write position
                    fftState.musicHistoryWritePos = (fftState.musicHistoryWritePos + 1) % bufferLen;
                    if (fftState.musicHistoryWritePos === 0) {
                        fftState.musicHistoryFilled = true;
                    }

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

    // Ensure music still plays through Web Audio API after teardown
    // (once createMediaElementSource is called, we must route through Web Audio)
    if (musicMediaSource) {
        const ctx = audioContext();
        if (ctx) {
            try {
                musicMediaSource.disconnect();
            } catch (e) {}
            musicMediaSource.connect(ctx.destination);
            console.log('Reconnected music to destination after teardown');
        }
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
export function isMusicWebAudioInitialized() { return musicMediaSourceInitialized; }
