import {
    chooseLocalMusicDirectory,
    downloadPublicMusicLibrary,
    getDirectoryPermission,
    getPreferredMusicSource,
    getSavedLocalMusicDirectory,
    scanLocalMusicDirectory,
    setPreferredMusicSource,
    supportsLocalMusicDirectories
} from './local-music-library.js';

const card = document.getElementById('offlineMusicCard');
const heading = document.getElementById('offlineMusicTitle');
const sourceButtons = document.querySelectorAll('[data-music-source]');
const playlistSelect = document.getElementById('offlineMusicPlaylistSelect');
const chooseButton = document.getElementById('chooseMusicFolderBtn');
const downloadButton = document.getElementById('downloadMusicBtn');
const status = document.getElementById('offlineMusicStatus');
const progress = document.getElementById('offlineMusicProgress');
const progressBar = document.getElementById('offlineMusicProgressBar');
const HIDDEN_PLAYLIST_UNLOCK_KEY = 'sender-playlists-unlocked';
const GERMAN_LULLABIES_PLAYLIST_ID = '1';
const SECRET_HOLD_MS = 3000;
let directoryHandle = null;
let germanLullabiesUnlocked = localStorage.getItem(HIDDEN_PLAYLIST_UNLOCK_KEY) === 'true';
let secretHoldTimer = null;
let availablePlaylists = [];
let localLibrary = null;

function updateDownloadButtonLabel() {
    const selectedPlaylist = localLibrary?.playlists.find(
        playlist => String(playlist.id) === String(playlistSelect.value)
    );
    downloadButton.textContent = selectedPlaylist?.files.length > 0
        ? 'Check for missing files'
        : 'Download selected';
}

function selectMusicSource(source) {
    const selectedSource = setPreferredMusicSource(source);
    sourceButtons.forEach(button => {
        const selected = button.dataset.musicSource === selectedSource;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
}

function populatePlaylistSelect(preferredPlaylistId = playlistSelect.value) {
    const visiblePlaylists = availablePlaylists.filter(playlist => (
        !playlist.hidden || (germanLullabiesUnlocked && String(playlist.id) === GERMAN_LULLABIES_PLAYLIST_ID)
    ));
    playlistSelect.replaceChildren();

    for (const playlist of visiblePlaylists) {
        const option = document.createElement('option');
        option.value = String(playlist.id);
        option.textContent = playlist.name;
        playlistSelect.appendChild(option);
    }

    if (visiblePlaylists.some(playlist => String(playlist.id) === String(preferredPlaylistId))) {
        playlistSelect.value = String(preferredPlaylistId);
    }
    playlistSelect.disabled = visiblePlaylists.length === 0;
    updateDownloadButtonLabel();
}

async function loadAvailablePlaylists() {
    try {
        const response = await fetch('/api/music?playlist=1');
        if (!response.ok) throw new Error(`Music API failed (${response.status})`);
        const data = await response.json();
        availablePlaylists = data.playlists || [];
        populatePlaylistSelect();
    } catch (err) {
        playlistSelect.disabled = true;
        setStatus('Could not load playlists', err.message || String(err), 'error');
    }
}

function updateSecretUnlockState(showMessage = false) {
    heading.classList.toggle('unlocked', germanLullabiesUnlocked);
    if (showMessage) {
        setStatus('German Lullabies unlocked', 'They will be included the next time music is downloaded.', 'ready');
    }
}

function startSecretHold(event) {
    if (germanLullabiesUnlocked || secretHoldTimer) return;
    if (event.type === 'pointerdown' && event.button !== 0) return;
    heading.classList.add('holding');
    secretHoldTimer = setTimeout(() => {
        secretHoldTimer = null;
        heading.classList.remove('holding');
        germanLullabiesUnlocked = true;
        localStorage.setItem(HIDDEN_PLAYLIST_UNLOCK_KEY, 'true');
        populatePlaylistSelect(GERMAN_LULLABIES_PLAYLIST_ID);
        updateSecretUnlockState(true);
        if (navigator.vibrate) navigator.vibrate(60);
    }, SECRET_HOLD_MS);
}

function cancelSecretHold() {
    if (secretHoldTimer) {
        clearTimeout(secretHoldTimer);
        secretHoldTimer = null;
    }
    heading.classList.remove('holding');
}

function setStatus(title, detail, state = '') {
    status.className = `offline-music-status ${state}`.trim();
    const heading = document.createElement('strong');
    const description = document.createElement('span');
    heading.textContent = title;
    description.textContent = detail;
    status.replaceChildren(heading, description);
}

function showProgress(completed, total) {
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progress.hidden = false;
    progressBar.style.width = `${percent}%`;
    progress.setAttribute('aria-valuenow', String(percent));
}

async function showDirectorySummary(handle) {
    localLibrary = await scanLocalMusicDirectory(handle);
    const trackCount = localLibrary?.playlists.reduce((sum, playlist) => sum + playlist.files.length, 0) || 0;
    chooseButton.textContent = 'Change folder';
    downloadButton.disabled = playlistSelect.disabled;
    updateDownloadButtonLabel();
    setStatus(
        localLibrary?.directoryName || handle.name,
        trackCount > 0
            ? `${trackCount} existing local track${trackCount === 1 ? '' : 's'} found — only missing files will be downloaded`
            : 'Selected — download music when connected to Wi-Fi',
        trackCount > 0 ? 'ready' : ''
    );
}

async function chooseDirectory() {
    try {
        directoryHandle = await chooseLocalMusicDirectory();
        selectMusicSource('local');
        await showDirectorySummary(directoryHandle);
    } catch (err) {
        if (err.name !== 'AbortError') {
            setStatus('Could not select folder', err.message || String(err), 'error');
        }
    }
}

chooseButton.addEventListener('click', chooseDirectory);
sourceButtons.forEach(button => {
    button.addEventListener('click', () => selectMusicSource(button.dataset.musicSource));
});
playlistSelect.addEventListener('change', updateDownloadButtonLabel);
heading.addEventListener('pointerdown', startSecretHold);
heading.addEventListener('pointerup', cancelSecretHold);
heading.addEventListener('pointercancel', cancelSecretHold);
heading.addEventListener('pointerleave', cancelSecretHold);
heading.addEventListener('contextmenu', event => event.preventDefault());

downloadButton.addEventListener('click', async () => {
    if (!playlistSelect.value) {
        setStatus('Choose a playlist', 'Select the one playlist to save on this device.', 'error');
        return;
    }

    if (!directoryHandle) {
        await chooseDirectory();
        if (!directoryHandle) return;
    }

    chooseButton.disabled = true;
    downloadButton.disabled = true;
    playlistSelect.disabled = true;
    downloadButton.textContent = 'Downloading…';

    try {
        const result = await downloadPublicMusicLibrary(
            directoryHandle,
            update => {
                showProgress(update.completed, update.total);
                if (update.phase === 'downloading') {
                    const item = update.track ? ` · ${update.track}` : '';
                    const skipped = update.skipped ? ` · ${update.skipped} already present` : '';
                    setStatus(
                        update.error ? 'One file could not be saved' : 'Saving music locally',
                        `${update.completed} of ${update.total}${skipped}${item}`,
                        update.error ? 'error' : ''
                    );
                }
            },
            {
                playlistIds: playlistSelect.value ? [playlistSelect.value] : [],
                allowedHiddenPlaylistIds: germanLullabiesUnlocked
                    ? [GERMAN_LULLABIES_PLAYLIST_ID]
                    : []
            }
        );
        if (result.failures.length > 0) {
            setStatus(
                'Download incomplete',
                `${result.failures.length} file${result.failures.length === 1 ? '' : 's'} failed. Tap download to retry.`,
                'error'
            );
        } else {
            setStatus(
                'Offline music ready',
                result.downloaded > 0
                    ? `${result.downloaded} new, ${result.skipped} already present`
                    : 'Everything was already downloaded',
                'ready'
            );
        }
    } catch (err) {
        setStatus('Download stopped', err.message || String(err), 'error');
    } finally {
        chooseButton.disabled = false;
        populatePlaylistSelect(playlistSelect.value);
        downloadButton.disabled = !directoryHandle || playlistSelect.disabled;
        try {
            localLibrary = directoryHandle ? await scanLocalMusicDirectory(directoryHandle) : null;
        } catch (err) {
            console.log('Could not refresh local music summary:', err.message || err);
        }
        updateDownloadButtonLabel();
    }
});

async function initialize() {
    selectMusicSource(getPreferredMusicSource());
    updateSecretUnlockState(false);
    await loadAvailablePlaylists();

    if (!supportsLocalMusicDirectories()) {
        card.classList.add('unsupported');
        chooseButton.disabled = true;
        downloadButton.disabled = true;
        setStatus('Local folders unavailable', 'Use Chrome 132+ or a recent Chromium browser.', 'error');
        return;
    }

    directoryHandle = await getSavedLocalMusicDirectory();
    if (!directoryHandle) return;

    const permission = await getDirectoryPermission(directoryHandle, 'read');
    if (permission === 'granted') {
        await showDirectorySummary(directoryHandle);
        return;
    }

    chooseButton.textContent = 'Reconnect folder';
    setStatus(directoryHandle.name, 'Tap reconnect to allow local playback again');
}

void initialize();
