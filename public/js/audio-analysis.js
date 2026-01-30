/**
 * Audio Analysis for receiver
 * Volume detection, RMS calculation, loud sound alerts, and noise gate
 */

// State
let audioContext = null;
let analyser = null;
let audioStream = null;
let audioAnalysisRunning = false;

// Noise gate state
let noiseGateGain = null;
let volumeGain = null;
let noiseGateThreshold = 0;
let isGating = false;
let noiseGateSource = null;
let videoElementSource = null;

// Callbacks
let onLoudSound = null;
let getSensitivity = null;
let getMusicPlaying = null;
let getIsConnected = null;
let onGatingChange = null;

/**
 * Initialize audio analysis module
 * @param {object} callbacks
 */
export function initAudioAnalysis(callbacks) {
    onLoudSound = callbacks.onLoudSound;
    getSensitivity = callbacks.getSensitivity;
    getMusicPlaying = callbacks.getMusicPlaying;
    getIsConnected = callbacks.getIsConnected;
    onGatingChange = callbacks.onGatingChange;
}

// Additional audio level elements (inline meter)
let audioLevelElements = [];

/**
 * Setup audio analysis for a stream
 * @param {MediaStream} stream
 * @param {HTMLElement} audioLevelElement
 * @param {HTMLElement} [inlineAudioLevelElement] - Optional inline meter
 */
export function setupAudioAnalysis(stream, audioLevelElement, inlineAudioLevelElement) {
    console.log('setupAudioAnalysis called, stream active:', stream?.active);

    // Store all audio level elements
    audioLevelElements = [audioLevelElement, inlineAudioLevelElement].filter(Boolean);

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

            // Update all audio level elements (drawer + inline)
            audioLevelElements.forEach(el => {
                if (el) el.style.width = percentage + '%';
            });

            // Apply noise gate if threshold is set
            if (noiseGateGain && noiseGateThreshold > 0) {
                const shouldGate = percentage < noiseGateThreshold;
                if (shouldGate !== isGating) {
                    isGating = shouldGate;
                    // Smooth transition to avoid clicks
                    const targetGain = shouldGate ? 0 : 1;
                    noiseGateGain.gain.setTargetAtTime(targetGain, audioContext.currentTime, 0.01);
                    if (onGatingChange) onGatingChange(shouldGate);
                }
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

/**
 * Set noise gate threshold
 * @param {number} threshold - Percentage threshold (0-50), 0 = off
 */
export function setNoiseGateThreshold(threshold) {
    noiseGateThreshold = threshold;
    console.log('Noise gate threshold set to:', threshold);

    // If threshold is 0, ensure gate is open
    if (threshold === 0 && noiseGateGain) {
        noiseGateGain.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);
        if (isGating) {
            isGating = false;
            if (onGatingChange) onGatingChange(false);
        }
    }
}

/**
 * Get current noise gate threshold
 */
export function getNoiseGateThreshold() {
    return noiseGateThreshold;
}

/**
 * Set up noise gate for video element audio
 * Routes video audio through Web Audio API with gain nodes for gating and volume
 * @param {HTMLVideoElement} videoElement - The video element to gate audio for
 * @param {number} initialVolume - Initial volume (0-1)
 */
export function setupNoiseGate(videoElement, initialVolume = 1) {
    if (!audioContext) {
        console.log('AudioContext not ready, cannot setup noise gate');
        return;
    }

    // Only create the source once per video element
    if (videoElementSource) {
        console.log('Noise gate already set up');
        return;
    }

    try {
        // Create media element source (can only be done once per element)
        videoElementSource = audioContext.createMediaElementSource(videoElement);

        // Create gain node for noise gating
        noiseGateGain = audioContext.createGain();
        noiseGateGain.gain.value = 1;

        // Create gain node for volume control
        // (video.volume no longer works after createMediaElementSource)
        volumeGain = audioContext.createGain();
        volumeGain.gain.value = initialVolume;

        // Connect: video -> noiseGate -> volume -> destination
        videoElementSource.connect(noiseGateGain);
        noiseGateGain.connect(volumeGain);
        volumeGain.connect(audioContext.destination);

        console.log('Noise gate set up for video element, initial volume:', initialVolume);
    } catch (err) {
        console.error('Error setting up noise gate:', err);
    }
}

/**
 * Set playback volume (used when audio is routed through Web Audio API)
 * @param {number} volume - Volume level (0-1)
 */
export function setPlaybackVolume(volume) {
    if (volumeGain) {
        volumeGain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.01);
    }
}

/**
 * Check if noise gate is currently gating (muting)
 */
export function isNoiseGateActive() {
    return isGating;
}

/**
 * Reset noise gate state
 */
export function resetNoiseGate() {
    isGating = false;
    if (noiseGateGain) {
        noiseGateGain.gain.value = 1;
    }
}
