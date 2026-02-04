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
let streamAudioSource = null;  // MediaStreamSource for noise gate (more reliable than MediaElementSource)
let videoElementSource = null; // Keep for backwards compatibility but prefer streamAudioSource

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
 * Get current playback volume (for ducking)
 */
export function getPlaybackVolume() {
    if (volumeGain) {
        return volumeGain.gain.value;
    }
    return 1;
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

            // Try to set the AudioContext to follow the default system output device
            // This ensures Bluetooth and other device changes are followed automatically
            if (audioContext.setSinkId) {
                audioContext.setSinkId({ type: 'default' }).then(() => {
                    console.log('AudioContext set to follow default output device');
                }).catch(err => {
                    console.warn('Could not set AudioContext to follow default device:', err);
                });
            }

            // Monitor for AudioContext suspension (e.g., when Bluetooth connects)
            audioContext.onstatechange = () => {
                console.log('AudioContext state changed to:', audioContext.state);
                if (audioContext.state === 'suspended') {
                    console.log('AudioContext suspended (device change?), attempting resume...');
                    audioContext.resume().then(() => {
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
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        audioAnalysisRunning = true;
        console.log('Audio analysis started successfully');

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

            // Apply noise gate if threshold is set
            if (noiseGateThreshold > 0) {
                if (!noiseGateGain) {
                    // Log every 100 frames to avoid spam
                    if (frameCount % 100 === 1) {
                        console.warn('Noise gate: threshold set but noiseGateGain not initialized - tap screen to enable');
                    }
                } else {
                    const shouldGate = percentage < noiseGateThreshold;
                    if (shouldGate !== isGating) {
                        isGating = shouldGate;
                        // Smooth transition to avoid clicks
                        const targetGain = shouldGate ? 0 : 1;
                        noiseGateGain.gain.setTargetAtTime(targetGain, audioContext.currentTime, 0.01);
                        console.log(`Noise gate: ${shouldGate ? 'MUTING' : 'UNMUTING'} (level=${percentage.toFixed(1)}%, threshold=${noiseGateThreshold}%)`);
                        if (onGatingChange) onGatingChange(shouldGate);
                    }
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
 * Set up noise gate using MediaStream directly (more reliable for WebRTC)
 * Routes stream audio through Web Audio API with gain nodes for gating and volume
 * @param {MediaStream} stream - The media stream to gate
 * @param {HTMLVideoElement} videoElement - The video element (will be muted)
 * @param {number} initialVolume - Initial volume (0-1)
 */
export function setupNoiseGateFromStream(stream, videoElement, initialVolume = 1) {
    console.log('setupNoiseGateFromStream called, audioContext:', !!audioContext, 'streamAudioSource:', !!streamAudioSource);

    if (!audioContext) {
        console.warn('Noise gate: AudioContext not ready - will retry on next interaction');
        return false;
    }

    // Only create the source once
    if (streamAudioSource) {
        console.log('Noise gate already set up (stream-based)');
        return true;
    }

    if (!stream) {
        console.warn('Noise gate: No stream provided');
        return false;
    }

    try {
        console.log('Creating MediaStreamSource for noise gate...');

        // Mute the video element to avoid double playback
        // Audio will come through Web Audio API instead
        videoElement.muted = true;

        // Create source from the stream directly (not the video element)
        streamAudioSource = audioContext.createMediaStreamSource(stream);

        // Create gain node for noise gating
        noiseGateGain = audioContext.createGain();
        noiseGateGain.gain.value = 1;

        // Create gain node for volume control
        volumeGain = audioContext.createGain();
        volumeGain.gain.value = initialVolume;

        // Connect: stream -> noiseGate -> volume -> destination
        streamAudioSource.connect(noiseGateGain);
        noiseGateGain.connect(volumeGain);
        volumeGain.connect(audioContext.destination);

        console.log('Noise gate set up successfully (stream-based), initial volume:', initialVolume);
        return true;
    } catch (err) {
        console.error('Error setting up noise gate from stream:', err);
        return false;
    }
}

/**
 * Set up noise gate for video element audio (legacy method)
 * Routes video audio through Web Audio API with gain nodes for gating and volume
 * @param {HTMLVideoElement} videoElement - The video element to gate audio for
 * @param {number} initialVolume - Initial volume (0-1)
 * @deprecated Use setupNoiseGateFromStream instead for WebRTC streams
 */
export function setupNoiseGate(videoElement, initialVolume = 1) {
    console.log('setupNoiseGate called, audioContext:', !!audioContext, 'videoElementSource:', !!videoElementSource);

    if (!audioContext) {
        console.warn('Noise gate: AudioContext not ready - will retry on next interaction');
        return false;
    }

    // Only create the source once per video element
    if (videoElementSource || streamAudioSource) {
        console.log('Noise gate already set up');
        return true;
    }

    try {
        console.log('Creating MediaElementSource for video element...');
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

        console.log('Noise gate set up successfully, initial volume:', initialVolume);
        return true;
    } catch (err) {
        console.error('Error setting up noise gate:', err);
        return false;
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
 * Check if audio is routed through Web Audio API (for noise gate/volume control)
 * When true, the video element should stay muted and volume controlled via setPlaybackVolume
 */
export function isAudioRoutedThroughWebAudio() {
    return !!(streamAudioSource || videoElementSource);
}

/**
 * Reset noise gate state (for reconnection)
 */
export function resetNoiseGate() {
    console.log('Resetting noise gate');
    isGating = false;

    // Disconnect and reset stream source
    if (streamAudioSource) {
        try {
            streamAudioSource.disconnect();
        } catch (e) {}
        streamAudioSource = null;
    }

    // Reset gain nodes (don't disconnect - they may still be connected to video element source)
    if (noiseGateGain) {
        noiseGateGain.gain.value = 1;
    }

    // Note: We don't reset videoElementSource because createMediaElementSource
    // can only be called once per element. The gain nodes remain connected.
}

/**
 * Disable noise gate audio routing (un-mute video element, disconnect Web Audio)
 * Call this when noise gate threshold is set to 0 to allow direct audio playback
 * which better supports Bluetooth device switching
 * @param {HTMLVideoElement} videoElement - The video element to un-mute
 */
export function disableNoiseGateRouting(videoElement) {
    console.log('Disabling noise gate routing for direct audio playback');

    // Disconnect stream source if it exists
    if (streamAudioSource) {
        try {
            streamAudioSource.disconnect();
        } catch (e) {}
        streamAudioSource = null;
    }

    // Reset gain nodes
    if (noiseGateGain) {
        noiseGateGain.gain.value = 1;
        noiseGateGain = null;
    }
    if (volumeGain) {
        volumeGain = null;
    }

    isGating = false;

    // Un-mute the video element so audio plays directly
    // This allows Bluetooth device switching to work properly
    if (videoElement) {
        videoElement.muted = false;
        console.log('Video element unmuted for direct audio playback');
    }
}
