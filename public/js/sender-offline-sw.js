const MUSIC_CACHE = 'sender-music-offline-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

function isMusicRequest(url) {
    return url.origin === self.location.origin && (
        url.pathname.startsWith('/mp3/') ||
        url.pathname === '/api/music'
    );
}

async function cacheSuccessfulResponse(cache, request, response) {
    if (response && response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
}

async function handleMusicMetadataRequest(request) {
    const cache = await caches.open(MUSIC_CACHE);

    try {
        const response = await fetch(request);
        return await cacheSuccessfulResponse(cache, request, response);
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        throw err;
    }
}

async function handleMusicFileRequest(request) {
    const cache = await caches.open(MUSIC_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }

    const response = await fetch(request);
    return await cacheSuccessfulResponse(cache, request, response);
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (!isMusicRequest(url)) {
        return;
    }

    if (url.pathname === '/api/music') {
        event.respondWith(handleMusicMetadataRequest(request));
        return;
    }

    event.respondWith(handleMusicFileRequest(request));
});