/**
 * Audio Analysis for receiver
 * Volume detection, RMS calculation, loud sound alerts, and noise gate
 *
 * IMPORTANT: Audio playback goes through the native <video> element, NOT through
 * Web Audio API. This is critical for Bluetooth compatibility - routing audio
 * through Web Audio breaks Bluetooth (A2DP) playback on many devices.
 *
 * The noise gate works by muting/unmuting the video element based on analysis,
 * rather than routing audio through a GainNode.
 */

// State
let audioContext = null;
let analyser = null;
let audioStream = null;
let audioAnalysisRunning = false;

// Noise gate state - uses video.muted instead of GainNode for Bluetooth compatibility
let noiseGateThreshold = 0;
let isGating = false;
let videoElement = null;  // Reference to video element for noise gate muting

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

/**
 * Set reference to video element for noise gate muting
 * @param {HTMLVideoElement} element
 */
export function setVideoElement(element) {
    videoElement = element;
}

/**
 * Get current playback volume (for ducking during PTT)
 * Returns the video element volume since we no longer route through Web Audio
 */
export function getPlaybackVolume() {
    if (videoElement) {
        return videoElement.volume;
    }
    return 1;
}

// Additional audio level elements (inline meter)
let audioLevelElements = [];

/**
 * Setup audio analysis for a stream
 * NOTE: This ONLY sets up analysis (AnalyserNode) - audio playback goes through
 * the native <video> element for Bluetooth compatibility.
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
 * Creates an AnalyserNode for volume detection ONLY - does NOT route audio playback.
 * Audio continues to play through the native <video> element for Bluetooth compatibility.
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
            console.log('Created AudioContext for analysis, state:', audioContext.state);

            // Monitor for AudioContext suspension (e.g., when Bluetooth connects)
            audioContext.onstatechange = () => {
                // Guard against the context being cleared during teardown
                if (!audioContext) return;
                console.log('AudioContext state changed to:', audioContext.state);
                if (audioContext.state === 'suspended') {
                    console.log('AudioContext suspended (device change?), attempting resume...');
                    audioContext.resume().then(() => {
                        if (!audioContext) return;
                        console.log('AudioContext resumed after suspension, state:', audioContext.state);
                    }).catch(err => {
                        console.warn('Could not auto-resume AudioContext:', err);
                    });
                }
            };

            // Listen for device changes (Bluetooth connect/disconnect)
            if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
                navigator.mediaDevices.addEventListener('devicechange', () => {
                    console.log('Audio device change detected');
                    if (audioContext && audioContext.state === 'suspended') {
                        console.log('Resuming AudioContext after device change...');
                        audioContext.resume().then(() => {
                            console.log('AudioContext resumed after device change, state:', audioContext.state);
                        }).catch(err => {
                            console.warn('Could not resume AudioContext after device change:', err);
                        });
                    }
                });
            }
        }

        if (audioContext.state === 'suspended') {
            console.log('AudioContext suspended, will resume on user interaction');
            return;
        }

        if (analyser) {
            analyser = null;
        }

        analyser = audioContext.createAnalyser();

        // Create a MediaStreamSource ONLY for analysis - NOT connected to destination
        // This allows volume detection without routing audio through Web Audio,
        // which would break Bluetooth (A2DP) playback
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        // NOTE: We do NOT connect analyser to audioContext.destination
        // Audio plays through the native <video> element instead

        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        audioAnalysisRunning = true;
        console.log('Audio analysis started (analysis-only, not routing playback)');

        let frameCount = 0;
        function updateAudioLevel() {
            if (!analyser || !audioAnalysisRunning) return;
            frameCount++;

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

            // Apply noise gate by muting/unmuting video element
            // This approach maintains Bluetooth compatibility
            if (noiseGateThreshold > 0 && videoElement) {
                const shouldGate = percentage < noiseGateThreshold;
                if (shouldGate !== isGating) {
                    isGating = shouldGate;
                    // Mute/unmute video element for noise gate
                    // Don't unmute if already muted by user or autoplay policy
                    if (shouldGate) {
                        videoElement.muted = true;
                        console.log(`Noise gate: MUTING (level=${percentage.toFixed(1)}%, threshold=${noiseGateThreshold}%)`);
                    } else {
                        videoElement.muted = false;
                        console.log(`Noise gate: UNMUTING (level=${percentage.toFixed(1)}%, threshold=${noiseGateThreshold}%)`);
                    }
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
 * Noise gate now works by muting/unmuting the video element based on audio level
 * @param {number} threshold - Percentage threshold (0-50), 0 = off
 */
export function setNoiseGateThreshold(threshold) {
    noiseGateThreshold = threshold;
    console.log('Noise gate threshold set to:', threshold);

    // If threshold is 0, ensure video is unmuted (gate is open)
    if (threshold === 0 && videoElement && isGating) {
        videoElement.muted = false;
        isGating = false;
        if (onGatingChange) onGatingChange(false);
    }
}

/**
 * Get current noise gate threshold
 */
export function getNoiseGateThreshold() {
    return noiseGateThreshold;
}

/**
 * Set playback volume
 * Uses native video element volume for Bluetooth compatibility
 * @param {number} volume - Volume level (0-1)
 */
export function setPlaybackVolume(volume) {
    if (videoElement) {
        videoElement.volume = volume;
    }
}

/**
 * Check if noise gate is currently gating (muting)
 */
export function isNoiseGateActive() {
    return isGating;
}

/**
 * Check if audio is routed through Web Audio API
 * Returns false now since we no longer route playback through Web Audio
 * (kept for API compatibility)
 */
export function isAudioRoutedThroughWebAudio() {
    return false;
}

/**
 * Reset noise gate state (for reconnection)
 */
export function resetNoiseGate() {
    console.log('Resetting noise gate');
    isGating = false;
    // Unmute video element if it was muted by noise gate
    if (videoElement) {
        videoElement.muted = false;
    }
}

/**
 * Cleanup audio analysis resources
 */
export function destroyAudioAnalysis() {
    audioAnalysisRunning = false;
    analyser = null;
    audioStream = null;
    if (audioContext) {
        audioContext.onstatechange = null;
        audioContext.close().catch(() => {});
        audioContext = null;
    }
}
