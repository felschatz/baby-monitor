# Baby Monitor - Copilot Instructions

## Project Overview

Real-time baby monitor web app using WebRTC for peer-to-peer streaming between two phones.
- **Sender** (`/sender/{session}`) - Baby's phone with camera/mic
- **Receiver** (`/receiver/{session}`) - Parent's phone viewing stream

Sessions isolate multiple monitors on the same server. Session name acts as a shared secret.

## Tech Stack

- **Runtime**: Node.js 21.7.x
- **Server**: Express 5.x (single dependency)
- **Signaling**: Server-Sent Events (SSE) + HTTP POST (no WebSockets)
- **Streaming**: WebRTC (RTCPeerConnection)
- **Frontend**: Vanilla JS, no frameworks

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express server, SSE endpoints, signaling, session management |
| `public/sender.html` | Camera/mic capture, WebRTC offer creation, session handling |
| `public/receiver.html` | Stream playback, PTT, audio analysis, session handling |
| `public/index.html` | Landing page with session input |
| `public/*.css` | Separate stylesheets for sender/receiver |

## Architecture Notes

- SSE used instead of WebSockets for simpler hosting compatibility
- Session-based isolation: each session has its own sender and receivers
- Session names are server-side only, never broadcast to clients
- Single sender per session, multiple receivers supported
- PTT (Push-to-Talk) works via WebRTC renegotiation
- Audio ducking reduces baby audio to 15% during PTT
- STUN servers: stunprotocol.org, nextcloud.com, sipgate.net

## API Endpoints

- `GET /api/sse/sender/:session` - SSE stream for sender in session
- `GET /api/sse/receiver/:session` - SSE stream for receivers in session
- `POST /api/signal` - WebRTC signaling (requires `session` in body, stripped before forwarding)
- `GET /api/status/:session` - JSON: `{senderActive, receiverCount}` for specific session
- `GET /api/status` - JSON: `{activeSessions, totalReceivers}` for global status
- `GET /api/music?playlist=1` - JSON: `{files: [{name, url}], playlists: ["1","2"], currentPlaylist, debugTimer}`

## Music/Playlist Structure

Music files are organized in numbered subdirectories under `mp3/`:
```
mp3/
├── 1/              # Playlist 1 (default)
│   └── name.txt    # Optional: custom display name (e.g., "German Lullabies")
├── 2/
│   └── name.txt    # e.g., "Lofi Hiphop"
└── 3/              # Falls back to "Playlist 3" if no name.txt
```

- Add `name.txt` to a playlist folder for custom display name
- Playlist selection persisted to localStorage (`sender-music-playlist`, `receiver-music-playlist`)
- Defaults to playlist "1" if no preference saved
- Receiver sends playlist ID with `music-start` signal; sender switches if needed
- Backwards compatible: falls back to root `mp3/` if no subdirectories exist

## URL Structure

- `/sender` - Landing page with session prompt
- `/s/{session}` - Sender page for specific session (bookmarkable)
- `/receiver` - Landing page with session prompt
- `/r/{session}` - Receiver page for specific session (bookmarkable)
- Short paths (`/s/`, `/r/`) avoid conflicts with static files on some hosting setups
- Session name stored in `localStorage` for convenience

## When Making Changes

1. Keep it dependency-light (Express only)
2. No WebSockets - use SSE + HTTP POST
3. No data storage - everything is peer-to-peer
4. Test on mobile browsers (Chrome Android recommended)
5. HTTPS required for camera/mic in production
6. CSS is in separate files, not inline
7. **Update documentation on significant changes:**
   - `CLAUDE.md` - Update for dev context changes
   - `.github/copilot-instructions.md` - Keep in sync with CLAUDE.md
   - `README.md` - Update for user-facing feature changes
8. **Trigger server restart:** After making changes, update the `// Wisdom:` comment at the end of `server.js` with a new random sentence of wisdom. This triggers nodemon to restart the server.
