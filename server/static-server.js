/**
 * Static file server with path security
 * Handles serving static files from public/ and mp3/ directories
 */

const path = require('path');
const fs = require('fs');
const { MIME_TYPES } = require('./utils');

/**
 * Send file response
 * @param {http.ServerResponse} res
 * @param {string} filePath
 */
function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        // Set cache headers - no caching for JS/CSS during development
        const headers = { 'Content-Type': contentType };
        if (ext === '.js' || ext === '.css') {
            headers['Cache-Control'] = 'no-cache, must-revalidate';
        }

        res.writeHead(200, headers);
        res.end(data);
    });
}

/**
 * Serve static files from a directory with path security
 * @param {http.ServerResponse} res
 * @param {string} basePath - Base directory to serve from
 * @param {string} urlPath - Requested URL path
 * @returns {boolean} Whether the request was handled
 */
function serveStatic(res, basePath, urlPath) {
    // Decode URL and prevent directory traversal
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(urlPath);
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return true;
    }

    // Normalize and check for directory traversal
    const safePath = path.normalize(decodedPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(basePath, safePath);

    // Ensure the resolved path is within the base directory
    if (!filePath.startsWith(basePath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return true;
    }

    try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
            sendFile(res, filePath);
            return true;
        }
    } catch (e) {
        // File doesn't exist
    }

    return false;
}

/**
 * Serve MP3 files from the mp3 directory
 * @param {http.ServerResponse} res
 * @param {string} pathname - Full URL pathname
 * @param {string} baseDir - Base directory of the application
 * @returns {boolean} Whether the request was handled
 */
function serveMp3(res, pathname, baseDir) {
    if (!pathname.startsWith('/mp3/')) {
        return false;
    }

    const mp3Path = pathname.slice(5); // Remove '/mp3/'
    const filePath = path.join(baseDir, 'mp3', decodeURIComponent(mp3Path));
    const mp3Base = path.join(baseDir, 'mp3');

    // Security: ensure path is within mp3 directory
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(mp3Base)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return true;
    }

    try {
        if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
            sendFile(res, normalizedPath);
            return true;
        }
    } catch (e) {
        // File doesn't exist
    }

    return false;
}

/**
 * Serve static files from the public directory
 * @param {http.ServerResponse} res
 * @param {string} pathname - URL pathname
 * @param {string} baseDir - Base directory of the application
 * @returns {boolean} Whether the request was handled
 */
function servePublic(res, pathname, baseDir) {
    const publicPath = path.join(baseDir, 'public', pathname);
    const publicBase = path.join(baseDir, 'public');

    // Security: ensure path is within public directory
    const normalizedPublicPath = path.normalize(publicPath);
    if (normalizedPublicPath.startsWith(publicBase)) {
        try {
            if (fs.existsSync(normalizedPublicPath) && fs.statSync(normalizedPublicPath).isFile()) {
                sendFile(res, normalizedPublicPath);
                return true;
            }
        } catch (e) {
            // File doesn't exist
        }
    }

    return false;
}

module.exports = {
    sendFile,
    serveStatic,
    serveMp3,
    servePublic
};
