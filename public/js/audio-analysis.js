/**
 * Audio Analysis for receiver
 * Volume detection, RMS calculation, and loud sound alerts
 */

// State
let audioContext = null;
let analyser = null;
let audioStream = null;
let audioAnalysisRunning = false;

// Callbacks
let onLoudSound = null;
let getSensitivity = null;
let getMusicPlaying = null;
let getIsConnected = null;

/**
 * Initialize audio analysis module
 * @param {object} callbacks
 */
export function initAudioAnalysis(callbacks) {
    onLoudSound = callbacks.onLoudSound;
    getSensitivity = callbacks.getSensitivity;
    getMusicPlaying = callbacks.getMusicPlaying;
    getIsConnected = callbacks.getIsConnected;
}

/**
 * Setup audio analysis for a stream
 * @param {MediaStream} stream
 * @param {HTMLElement} audioLevelElement
 */
export function setupAudioAnalysis(stream, audioLevelElement) {
    console.log('setupAudioAnalysis called, stream active:', stream?.active);

    // If we're getting a new stream, reset the analysis state
    // This happens when video mode is toggled and a new peer connection is created
    if (stream !== audioStream) {
        console.log('New audio stream detected, resetting analysis');
        audioAnalysisRunning = false;
        analyser = null;
    }

    audioStream = stream;
    tryStartAudioAnalysis(audioLevelElement);
}

/**
 * Try to start audio analysis
 */
export async function tryStartAudioAnalysis(audioLevelElement) {
    if (audioAnalysisRunning) {
        console.log('Audio analysis already running');
        return;
    }
    if (!audioStream) {
        console.log('No audio stream available yet');
        return;
    }

    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Created AudioContext, state:', audioContext.state);
        }

        if (audioContext.state === 'suspended') {
            console.log('AudioContext suspended, will resume on user interaction');
            return;
        }

        if (analyser) {
            analyser = null;
        }

        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        audioAnalysisRunning = true;
        console.log('Audio analysis started successfully');

        function updateAudioLevel() {
            if (!analyser || !audioAnalysisRunning) return;

            analyser.getByteFrequencyData(dataArray);

            // Calculate RMS (root mean square) for better loudness detection
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const percentage = Math.min(100, (rms / 128) * 100);

            if (audioLevelElement) {
                audioLevelElement.style.width = percentage + '%';
            }

            // Check for loud sounds based on sensitivity
            const baseThreshold = 100 - getSensitivity();
            const isConnected = getIsConnected();
            const musicPlaying = getMusicPlaying();

            if (musicPlaying) {
                // Two-tier alerts during music playback
                const softThreshold = Math.min(95, baseThreshold + 20);
                const loudThreshold = Math.min(95, baseThreshold + 40);

                if (percentage > loudThreshold && isConnected) {
                    console.log('Very loud sound during music! Level:', percentage.toFixed(1), 'Threshold:', loudThreshold);
                    if (onLoudSound) onLoudSound(false);
                } else if (percentage > softThreshold && isConnected) {
                    console.log('Loud sound during music. Level:', percentage.toFixed(1), 'Threshold:', softThreshold);
                    if (onLoudSound) onLoudSound(true);
                }
            } else {
                if (percentage > baseThreshold && isConnected) {
                    console.log('Loud sound detected! Level:', percentage.toFixed(1), 'Threshold:', baseThreshold);
                    if (onLoudSound) onLoudSound(false);
                }
            }

            requestAnimationFrame(updateAudioLevel);
        }

        updateAudioLevel();
    } catch (err) {
        console.error('Audio analysis error:', err);
        audioAnalysisRunning = false;
    }
}

/**
 * Resume AudioContext and start audio analysis on user interaction
 * @param {HTMLElement} audioLevelElement
 */
export async function ensureAudioContext(audioLevelElement) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Created AudioContext on interaction, state:', audioContext.state);
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('AudioContext resumed, state:', audioContext.state);
        }

        if (audioStream && !audioAnalysisRunning) {
            console.log('Starting audio analysis after user interaction');
            tryStartAudioAnalysis(audioLevelElement);
        }
    } catch (err) {
        console.error('Error ensuring AudioContext:', err);
    }
}

/**
 * Reset audio analysis state (for reconnection)
 */
export function resetAudioAnalysis() {
    audioAnalysisRunning = false;
    analyser = null;
    audioStream = null;
}

/**
 * Get the AudioContext
 */
export function getAudioContext() {
    return audioContext;
}
