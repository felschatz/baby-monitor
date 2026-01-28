/**
 * Music Player for sender
 * Handles playlist loading, shuffle, timer, and playback
 */

// State
let musicPlaylist = [];
let musicPlaylists = [];
let currentPlaylistId = localStorage.getItem('sender-music-playlist') || '1';
let musicShuffled = [];
let musicCurrentIndex = 0;
let musicPlaying = false;
let musicTimer = null;
let musicTimerRemaining = 0;
let musicStatusInterval = null;
let isFadingOut = false;

// DOM elements (set via init)
let musicAudio = null;
let musicIndicator = null;
let musicTrackName = null;
let musicTimerEl = null;
let musicControlsPanel = null;
let musicBtn = null;
let musicPlaylistSelect = null;
let musicTimerSelect = null;
let musicResetBtn = null;
let musicVolumeSlider = null;
let musicVolumeValue = null;
let musicLabel = null;

// Callbacks
let onMusicStatusBroadcast = null;
let onEchoCancelSetup = null;
let onEchoCancelTeardown = null;

/**
 * Initialize music player
 * @param {object} elements - DOM elements
 * @param {object} callbacks - Callback functions
 */
export function initMusicPlayer(elements, callbacks) {
    musicAudio = elements.musicAudio;
    musicIndicator = elements.musicIndicator;
    musicTrackName = elements.musicTrackName;
    musicTimerEl = elements.musicTimerEl;
    musicControlsPanel = elements.musicControlsPanel;
    musicBtn = elements.musicBtn;
    musicPlaylistSelect = elements.musicPlaylistSelect;
    musicTimerSelect = elements.musicTimerSelect;
    musicResetBtn = elements.musicResetBtn;
    musicVolumeSlider = elements.musicVolumeSlider;
    musicVolumeValue = elements.musicVolumeValue;
    musicLabel = elements.musicLabel;

    onMusicStatusBroadcast = callbacks.onMusicStatusBroadcast;
    onEchoCancelSetup = callbacks.onEchoCancelSetup;
    onEchoCancelTeardown = callbacks.onEchoCancelTeardown;

    // Load saved music volume from localStorage
    const savedMusicVolume = localStorage.getItem('sender-music-volume');
    if (savedMusicVolume !== null) {
        musicVolumeSlider.value = savedMusicVolume;
        musicVolumeValue.textContent = savedMusicVolume + '%';
        musicAudio.volume = parseInt(savedMusicVolume) / 100;
    } else {
        musicAudio.volume = 0.5;
    }

    // Music volume control
    musicVolumeSlider.addEventListener('input', () => {
        const value = musicVolumeSlider.value;
        musicAudio.volume = value / 100;
        musicVolumeValue.textContent = value + '%';
        localStorage.setItem('sender-music-volume', value);
    });

    // Music button click handler
    musicBtn.addEventListener('click', toggleMusicLocal);

    // Reset timer button click handler
    musicResetBtn.addEventListener('click', () => {
        if (!musicPlaying) return;
        const timerMinutes = parseInt(musicTimerSelect.value);
        console.log('Resetting music timer to', timerMinutes, 'minutes');
        musicTimerRemaining = timerMinutes * 60;
        updateMusicTimerDisplay();
        broadcastMusicStatus();
    });

    // Handle playlist selection change
    musicPlaylistSelect.addEventListener('change', () => {
        currentPlaylistId = musicPlaylistSelect.value;
        localStorage.setItem('sender-music-playlist', currentPlaylistId);
        console.log('Switched to playlist:', currentPlaylistId);

        if (musicPlaying) {
            stopMusic(true);
        }

        fetchMusicPlaylist(currentPlaylistId);
    });

    // Handle track ended - play next
    musicAudio.addEventListener('ended', () => {
        if (musicPlaying) {
            playNextTrack();
        }
    });

    // Fetch playlist on load
    fetchMusicPlaylist();
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Fetch available music files for a specific playlist
 */
export async function fetchMusicPlaylist(playlistId = null) {
    try {
        const playlist = playlistId || currentPlaylistId;
        const response = await fetch(`/api/music?playlist=${encodeURIComponent(playlist)}`);
        const data = await response.json();
        musicPlaylist = data.files || [];
        musicPlaylists = data.playlists || [];

        console.log('Music playlist loaded:', musicPlaylist.length, 'tracks from playlist', playlist);
        console.log('Available playlists:', musicPlaylists);

        if (musicPlaylists.length > 0) {
            musicPlaylistSelect.innerHTML = '';
            musicPlaylists.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                if (p.id === playlist) option.selected = true;
                musicPlaylistSelect.appendChild(option);
            });
            musicPlaylistSelect.style.display = 'inline-block';

            const playlistIds = musicPlaylists.map(p => p.id);
            if (!playlistIds.includes(currentPlaylistId)) {
                currentPlaylistId = musicPlaylists[0].id;
                localStorage.setItem('sender-music-playlist', currentPlaylistId);
                return fetchMusicPlaylist(currentPlaylistId);
            }
        } else {
            musicPlaylistSelect.style.display = 'none';
        }

        if (musicPlaylist.length > 0 || musicPlaylists.length > 0) {
            musicControlsPanel.style.display = 'block';
        }

        if (data.debugTimer && !musicTimerSelect.querySelector('option[value="1"]')) {
            const debugOption = document.createElement('option');
            debugOption.value = '1';
            debugOption.textContent = '1 min (debug)';
            musicTimerSelect.insertBefore(debugOption, musicTimerSelect.firstChild);
        }
    } catch (err) {
        console.error('Failed to fetch music playlist:', err);
        musicPlaylist = [];
    }
}

/**
 * Toggle music playback locally
 */
function toggleMusicLocal() {
    if (musicPlaying) {
        fadeOutAndStop();
    } else {
        const timerMinutes = parseInt(musicTimerSelect.value);
        startMusic(timerMinutes);
    }
}

/**
 * Update music controls UI
 */
function updateMusicControlsUI() {
    if (musicPlaying) {
        musicBtn.textContent = '⏹️';
        musicBtn.classList.add('active');
        musicLabel.textContent = 'Stop music';
        musicResetBtn.style.display = 'inline-block';
    } else {
        musicBtn.textContent = '🎵';
        musicBtn.classList.remove('active');
        musicLabel.textContent = 'Play lullabies';
        musicResetBtn.style.display = 'none';
    }
}

/**
 * Start music playback
 */
export function startMusic(timerMinutes, echoCancelEnabled = false) {
    if (musicPlaylist.length === 0) {
        console.log('No music files available');
        return;
    }

    console.log('Starting music with', timerMinutes, 'minute timer');
    musicPlaying = true;
    isFadingOut = false;
    musicShuffled = shuffleArray(musicPlaylist);
    musicCurrentIndex = 0;
    musicTimerRemaining = timerMinutes * 60;

    musicIndicator.classList.add('active');
    updateMusicControlsUI();

    const savedVol = localStorage.getItem('sender-music-volume');
    musicAudio.volume = savedVol !== null ? parseInt(savedVol) / 100 : 0.5;

    if (musicTimer) clearInterval(musicTimer);
    musicTimer = setInterval(() => {
        musicTimerRemaining--;
        updateMusicTimerDisplay();
        if (musicTimerRemaining <= 0) {
            console.log('Music timer expired');
            fadeOutAndStop();
        }
    }, 1000);

    if (musicStatusInterval) clearInterval(musicStatusInterval);
    musicStatusInterval = setInterval(broadcastMusicStatus, 5000);

    playNextTrack();

    if (echoCancelEnabled && onEchoCancelSetup) {
        setTimeout(() => {
            onEchoCancelSetup();
        }, 100);
    }

    broadcastMusicStatus();
}

/**
 * Play next track in shuffled playlist
 */
function playNextTrack() {
    if (!musicPlaying || musicShuffled.length === 0) return;

    const track = musicShuffled[musicCurrentIndex];
    console.log('Playing track:', track.name);
    musicTrackName.textContent = track.name;

    musicAudio.src = track.url;
    musicAudio.play().catch(err => {
        console.error('Music play error:', err);
    });

    musicCurrentIndex = (musicCurrentIndex + 1) % musicShuffled.length;

    if (musicCurrentIndex === 0 && musicPlaying) {
        musicShuffled = shuffleArray(musicPlaylist);
    }
}

/**
 * Fade out and stop music
 */
export function fadeOutAndStop() {
    if (isFadingOut || !musicPlaying) return;
    isFadingOut = true;
    console.log('Fading out music...');

    const fadeInterval = 50;
    const fadeDuration = 5000;
    const steps = fadeDuration / fadeInterval;
    const startVolume = musicAudio.volume;
    const volumeStep = startVolume / steps;

    if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
    }

    let currentVolume = startVolume;
    const fadeTimer = setInterval(() => {
        currentVolume -= volumeStep;
        if (currentVolume > 0.01) {
            musicAudio.volume = currentVolume;
        } else {
            clearInterval(fadeTimer);
            musicAudio.volume = 0;
            isFadingOut = false;
            stopMusic(true);
        }
    }, fadeInterval);
}

/**
 * Stop music playback
 */
export function stopMusic(broadcast = true) {
    console.log('Stopping music');
    musicPlaying = false;
    musicAudio.pause();
    musicAudio.src = '';

    const savedVol = localStorage.getItem('sender-music-volume');
    musicAudio.volume = savedVol !== null ? parseInt(savedVol) / 100 : 0.5;

    if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
    }

    if (musicStatusInterval) {
        clearInterval(musicStatusInterval);
        musicStatusInterval = null;
    }

    musicIndicator.classList.remove('active');
    musicTimerRemaining = 0;

    if (onEchoCancelTeardown) {
        onEchoCancelTeardown();
    }

    updateMusicControlsUI();

    if (broadcast) {
        broadcastMusicStatus();
    }
}

/**
 * Update timer display
 */
function updateMusicTimerDisplay() {
    const mins = Math.floor(musicTimerRemaining / 60);
    const secs = musicTimerRemaining % 60;
    musicTimerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')} remaining`;
}

/**
 * Broadcast music status to receivers
 */
export function broadcastMusicStatus() {
    if (!onMusicStatusBroadcast) return;

    const currentTrack = musicPlaying && musicShuffled.length > 0
        ? musicShuffled[(musicCurrentIndex - 1 + musicShuffled.length) % musicShuffled.length].name
        : '';

    onMusicStatusBroadcast({
        playing: musicPlaying,
        currentTrack: currentTrack,
        timerRemaining: musicTimerRemaining
    });
}

/**
 * Handle music timer reset
 */
export function resetMusicTimer(timerMinutes) {
    if (!musicPlaying) return;
    musicTimerRemaining = timerMinutes * 60;
    updateMusicTimerDisplay();
    broadcastMusicStatus();
}

/**
 * Switch playlist
 */
export function switchPlaylist(playlistId) {
    if (playlistId === currentPlaylistId) return;

    currentPlaylistId = playlistId;
    localStorage.setItem('sender-music-playlist', currentPlaylistId);
    if (musicPlaylistSelect.value !== currentPlaylistId) {
        musicPlaylistSelect.value = currentPlaylistId;
    }
    return fetchMusicPlaylist(currentPlaylistId);
}

// Getters
export function isMusicPlaying() { return musicPlaying; }
export function getMusicAudio() { return musicAudio; }
export function getCurrentPlaylistId() { return currentPlaylistId; }
