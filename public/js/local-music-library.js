const DB_NAME = 'baby-monitor-local-music';
const DB_VERSION = 1;
const STORE_NAME = 'settings';
const DIRECTORY_HANDLE_KEY = 'music-directory-handle';
const MANIFEST_FILE = '.baby-monitor-music.json';
const MUSIC_SOURCE_STORAGE_KEY = 'sender-music-source';

export function getPreferredMusicSource() {
    return localStorage.getItem(MUSIC_SOURCE_STORAGE_KEY) === 'local' ? 'local' : 'online';
}

export function setPreferredMusicSource(source) {
    const normalized = source === 'online' ? 'online' : 'local';
    localStorage.setItem(MUSIC_SOURCE_STORAGE_KEY, normalized);
    return normalized;
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readSetting(key) {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const request = transaction.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function writeSetting(key, value) {
    const db = await openDatabase();
    try {
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).put(value, key);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally {
        db.close();
    }
}

export function supportsLocalMusicDirectories() {
    return typeof window.showDirectoryPicker === 'function' && 'indexedDB' in window;
}

export async function getDirectoryPermission(handle, mode = 'read') {
    if (!handle) return 'denied';
    if (typeof handle.queryPermission !== 'function') return 'granted';
    return handle.queryPermission({ mode });
}

export async function requestDirectoryPermission(handle, mode = 'read') {
    if (!handle) return false;
    const currentPermission = await getDirectoryPermission(handle, mode);
    if (currentPermission === 'granted') return true;
    if (typeof handle.requestPermission !== 'function') return false;
    return (await handle.requestPermission({ mode })) === 'granted';
}

export async function chooseLocalMusicDirectory() {
    if (!supportsLocalMusicDirectories()) {
        throw new Error('Directory access is not supported by this browser. Use a recent Chrome or Edge version.');
    }

    const handle = await window.showDirectoryPicker({
        id: 'baby-monitor-music',
        mode: 'readwrite',
        startIn: 'music'
    });
    await writeSetting(DIRECTORY_HANDLE_KEY, handle);
    return handle;
}

export async function getSavedLocalMusicDirectory() {
    if (!supportsLocalMusicDirectories()) return null;
    try {
        return await readSetting(DIRECTORY_HANDLE_KEY);
    } catch (err) {
        console.log('Could not restore local music directory:', err.message || err);
        return null;
    }
}

async function readTextFile(directoryHandle, filename) {
    try {
        const fileHandle = await directoryHandle.getFileHandle(filename);
        return (await fileHandle.getFile()).text();
    } catch (err) {
        if (err.name === 'NotFoundError') return '';
        throw err;
    }
}

async function readManifest(directoryHandle) {
    try {
        const raw = await readTextFile(directoryHandle, MANIFEST_FILE);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.log('Could not read local music manifest:', err.message || err);
        return null;
    }
}

async function writeTextFile(directoryHandle, filename, text) {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
}

async function getExistingFile(directoryHandle, filename) {
    try {
        const fileHandle = await directoryHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        return file.size > 0 ? fileHandle : null;
    } catch (err) {
        if (err.name === 'NotFoundError') return null;
        throw err;
    }
}

async function getExistingDirectory(directoryHandle, name) {
    try {
        return await directoryHandle.getDirectoryHandle(name);
    } catch (err) {
        if (err.name === 'NotFoundError') return null;
        throw err;
    }
}

async function downloadFile(directoryHandle, track) {
    const filename = decodeURIComponent(new URL(track.url, window.location.origin).pathname.split('/').pop());
    const existingHandle = await getExistingFile(directoryHandle, filename);
    if (existingHandle) return { downloaded: false, filename };

    const response = await fetch(track.url);
    if (!response.ok) {
        throw new Error(`Could not download ${track.name} (${response.status})`);
    }

    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(await response.blob());
    await writable.close();
    return { downloaded: true, filename };
}

function getSafeDirectoryName(name, fallback) {
    const sanitized = String(name || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/[. ]+$/g, '')
        .trim();
    return sanitized || `Playlist ${fallback}`;
}

/**
 * Download every public playlist into the selected user-visible directory.
 * Hidden playlists are omitted unless their IDs are explicitly allowed after
 * a separate UI unlock action.
 */
export async function downloadPublicMusicLibrary(directoryHandle, onProgress = () => {}, options = {}) {
    if (!(await requestDirectoryPermission(directoryHandle, 'readwrite'))) {
        throw new Error('Read and write access to the music directory is required.');
    }

    const indexResponse = await fetch('/api/music?playlist=1');
    if (!indexResponse.ok) throw new Error(`Could not load playlists (${indexResponse.status})`);
    const indexData = await indexResponse.json();
    const allowedHiddenPlaylistIds = new Set(
        (options.allowedHiddenPlaylistIds || []).map(String)
    );
    const selectedPlaylistIds = new Set(
        (options.playlistIds || []).map(String)
    );
    const publicPlaylists = (indexData.playlists || []).filter(playlist => (
        (!playlist.hidden || allowedHiddenPlaylistIds.has(String(playlist.id))) &&
        (selectedPlaylistIds.size === 0 || selectedPlaylistIds.has(String(playlist.id)))
    ));
    const playlistData = [];

    if ((indexData.playlists || []).length === 0 && Array.isArray(indexData.files)) {
        playlistData.push({ id: 'default', name: 'Lullabies', hidden: false, files: indexData.files });
    } else {
        for (const playlist of publicPlaylists) {
            const response = await fetch(`/api/music?playlist=${encodeURIComponent(playlist.id)}`);
            if (!response.ok) throw new Error(`Could not load ${playlist.name} (${response.status})`);
            const data = await response.json();
            playlistData.push({ ...playlist, files: data.files || [] });
        }
    }

    const total = playlistData.reduce((sum, playlist) => sum + playlist.files.length, 0);
    const existingManifest = await readManifest(directoryHandle);
    const existingManifestPlaylists = existingManifest?.playlists || [];
    let completed = 0;
    let downloaded = 0;
    let skipped = 0;
    const failures = [];
    onProgress({ phase: 'downloading', completed, total, downloaded, skipped });

    for (const playlist of playlistData) {
        const existingMetadata = existingManifestPlaylists.find(entry => String(entry.id) === String(playlist.id));
        const namedDirectory = getSafeDirectoryName(playlist.name, playlist.id);
        const directoryCandidates = [
            existingMetadata?.directory,
            existingMetadata?.id,
            namedDirectory,
            playlist.id
        ].filter((name, index, names) => name && names.indexOf(name) === index);
        let playlistDirectory = playlist.id === 'default' ? directoryHandle : null;

        if (!playlistDirectory) {
            for (const candidate of directoryCandidates) {
                playlistDirectory = await getExistingDirectory(directoryHandle, String(candidate));
                if (playlistDirectory) {
                    playlist.directory = String(candidate);
                    break;
                }
            }
        }

        if (!playlistDirectory) {
            playlist.directory = namedDirectory;
            playlistDirectory = await directoryHandle.getDirectoryHandle(playlist.directory, { create: true });
        }
        await writeTextFile(playlistDirectory, 'name.txt', playlist.name);

        for (const track of playlist.files) {
            let error = null;
            try {
                const result = await downloadFile(playlistDirectory, track);
                if (result.downloaded) downloaded += 1;
                else skipped += 1;
            } catch (err) {
                error = err.message || String(err);
                failures.push({ playlist: playlist.name, track: track.name, error });
            }
            completed += 1;
            onProgress({
                phase: 'downloading',
                completed,
                total,
                downloaded,
                skipped,
                playlist: playlist.name,
                track: track.name,
                error
            });
        }
    }

    const downloadedIds = new Set(playlistData.map(playlist => String(playlist.id)));
    const mergedManifestPlaylists = [
        ...existingManifestPlaylists.filter(playlist => !downloadedIds.has(String(playlist.id))),
        ...playlistData.map(({ id, name, hidden, directory }) => ({
            id,
            name,
            hidden: !!hidden,
            directory
        }))
    ];
    await writeTextFile(directoryHandle, MANIFEST_FILE, JSON.stringify({
        version: 1,
        downloadedAt: new Date().toISOString(),
        playlists: mergedManifestPlaylists
    }, null, 2));

    const result = { completed, total, downloaded, skipped, failures };
    onProgress({ phase: 'complete', ...result });
    return result;
}

async function scanPlaylistDirectory(directoryHandle, playlist) {
    const files = [];
    for await (const [filename, handle] of directoryHandle.entries()) {
        if (handle.kind !== 'file' || !filename.toLowerCase().endsWith('.mp3')) continue;
        files.push({
            name: filename.replace(/\.mp3$/i, ''),
            localFileHandle: handle
        });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { ...playlist, files };
}

export async function scanLocalMusicDirectory(directoryHandle) {
    if ((await getDirectoryPermission(directoryHandle, 'read')) !== 'granted') return null;

    const manifest = await readManifest(directoryHandle);
    const manifestPlaylists = new Map((manifest?.playlists || []).map(playlist => [
        String(playlist.directory || playlist.id),
        playlist
    ]));
    const playlists = [];
    const rootFiles = [];

    for await (const [name, handle] of directoryHandle.entries()) {
        if (handle.kind === 'file' && name.toLowerCase().endsWith('.mp3')) {
            rootFiles.push({ name: name.replace(/\.mp3$/i, ''), localFileHandle: handle });
            continue;
        }
        if (handle.kind !== 'directory') continue;

        const metadata = manifestPlaylists.get(name);
        const customName = (await readTextFile(handle, 'name.txt')).trim();
        const playlist = await scanPlaylistDirectory(handle, {
            id: String(metadata?.id || name),
            name: metadata?.name || customName || `Playlist ${name}`,
            hidden: metadata?.hidden ?? (name === '1' || name === '2')
        });
        if (playlist.files.length > 0) playlists.push(playlist);
    }

    if (rootFiles.length > 0) {
        rootFiles.sort((a, b) => a.name.localeCompare(b.name));
        playlists.push({ id: 'default', name: 'Lullabies', hidden: false, files: rootFiles });
    }

    playlists.sort((a, b) => a.name.localeCompare(b.name));
    return {
        directoryName: directoryHandle.name,
        playlists
    };
}
