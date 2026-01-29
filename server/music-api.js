/**
 * Music API for serving playlist information
 * Handles playlist scanning and name.txt parsing
 */

const path = require('path');
const fs = require('fs');
const { sendJson } = require('./utils');

/**
 * Handle music API endpoint
 * @param {http.ServerResponse} res
 * @param {object} query - Query parameters
 * @param {string} baseDir - Base directory of the application
 * @param {boolean} debugTimer - Whether to enable debug timer option
 */
function handleMusicApi(res, query, baseDir, debugTimer = false) {
    const mp3Dir = path.join(baseDir, 'mp3');
    const playlist = query.playlist || '1';

    try {
        if (!fs.existsSync(mp3Dir)) {
            return sendJson(res, { files: [], playlists: [], debugTimer });
        }

        const entries = fs.readdirSync(mp3Dir, { withFileTypes: true });
        const playlists = entries
            .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map(entry => {
                const playlistPath = path.join(mp3Dir, entry.name);
                const nameFile = path.join(playlistPath, 'name.txt');
                let displayName = `Playlist ${entry.name}`;

                if (fs.existsSync(nameFile)) {
                    try {
                        displayName = fs.readFileSync(nameFile, 'utf8').trim();
                    } catch (e) {
                        // Keep default name on error
                    }
                }

                const hidden = entry.name === '1' || entry.name === '2';
                return { id: entry.name, name: displayName, hidden };
            })
            .sort((a, b) => parseInt(a.id) - parseInt(b.id));

        let files = [];
        const playlistDir = path.join(mp3Dir, playlist);

        if (playlists.length > 0 && fs.existsSync(playlistDir)) {
            files = fs.readdirSync(playlistDir)
                .filter(file => file.toLowerCase().endsWith('.mp3'))
                .map(file => ({
                    name: file.replace(/\.mp3$/i, ''),
                    url: `/mp3/${encodeURIComponent(playlist)}/${encodeURIComponent(file)}`
                }));
        } else if (playlists.length === 0) {
            files = entries
                .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.mp3'))
                .map(entry => ({
                    name: entry.name.replace(/\.mp3$/i, ''),
                    url: `/mp3/${encodeURIComponent(entry.name)}`
                }));
        }

        sendJson(res, {
            files,
            playlists,
            currentPlaylist: playlists.length > 0 ? playlist : null,
            debugTimer
        });
    } catch (err) {
        console.error('Music API error:', err);
        sendJson(res, { files: [], playlists: [], debugTimer });
    }
}

module.exports = {
    handleMusicApi
};
