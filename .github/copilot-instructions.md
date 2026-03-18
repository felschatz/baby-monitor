# Baby Monitor - Development Context

## Project Overview

Real-time baby monitor web app using WebRTC for direct or server-relayed streaming between two phones.
- **Sender** (`/sender/{session}`) - Baby's phone with camera/mic
- **Receiver** (`/receiver/{session}`) - Parent's phone viewing stream

Sessions isolate multiple monitors on the same server. Session name acts as a shared secret.

## Tech Stack

- **Runtime**: Node.js 21.7.x
- **Server**: Pure Node.js http module with optional server-side WebRTC relay
- **Signaling**: Server-Sent Events (SSE) + HTTP POST (no WebSockets)
- **Streaming**: WebRTC (RTCPeerConnection)
- **Frontend**: Vanilla JS, no frameworks

## Key Files

### Server Modules (`server/`)

| Module | Purpose |
|--------|---------|
| `server.js` | Thin wrapper for backwards compatibility, starts the server |
| `server/index.js` | HTTP server, main router, env loading |
| `server/relay-manager.js` | Server-side WebRTC relay bridge + client ICE config |
| `server/session-manager.js` | Session state (Map), cleanup |
| `server/sse-manager.js` | SSE setup, broadcast, heartbeats |
| `server/signal-router.js` | WebRTC signaling message handlers |
| `server/music-api.js` | Playlist scanning, name.txt parsing |
| `server/static-server.js` | File serving, MIME types, path security |
| `server/utils.js` | parseJsonBody, sendJson, matchRoute, generateId |

### Frontend Modules (`public/js/`)

**Shared modules** (used by sender & receiver):

| Module | Purpose |
|--------|---------|
| `keep-awake.js` | Wake lock API, NoSleep video, auto-shutdown timer |
| `session.js` | URL parsing, localStorage, session prompt |
| `signaling.js` | SSE connection, sendSignal(), reconnection |
| `webrtc.js` | Runtime ICE config loading, peer connection utilities |

**Sender modules**:

| Module | Purpose |
|--------|---------|
| `screen-dimming.js` | Inactivity timer, dim overlay |
| `music-player.js` | Playlist loading, shuffle, timer, playback |
| `echo-cancellation.js` | FFT, spectral subtraction, fallback mode |
| `sender-webrtc.js` | Offer creation, stream handling, PTT receive |
| `sender-app.js` | Main orchestration, event wiring |

**Receiver modules**:

| Module | Purpose |
|--------|---------|
| `audio-analysis.js` | Volume detection, RMS calculation, alerts |
| `video-playback.js` | Autoplay handling, track monitoring |
| `ptt.js` | Push-to-talk, audio ducking |
| `receiver-webrtc.js` | Answer creation, offer handling |
| `receiver-app.js` | Main orchestration, event wiring |

### HTML/CSS Files

| File | Purpose |
|------|---------|
| `public/sender.html` | Sender page structure, loads `sender-app.js` module |
| `public/receiver.html` | Receiver page structure, loads `receiver-app.js` module |
| `public/index.html` | Landing page with session input |
| `public/*.css` | Separate stylesheets for sender/receiver |

## Architecture Notes

- SSE used instead of WebSockets for simpler hosting compatibility
- Session-based isolation: each session has its own sender and receivers
- Session names are server-side only, never broadcast to clients
- Single sender per session, multiple receivers supported
- Optional relay mode bridges media through the Node server with paired WebRTC peer connections
- PTT (Push-to-Talk) works via WebRTC `replaceTrack()` (no renegotiation)
- Relay mode preserves PTT by bridging a dedicated audio transceiver through the server
- Audio ducking reduces baby audio to 15% during PTT
- STUN servers: stunprotocol.org, nextcloud.com, sipgate.net
- FFT-based spectral subtraction for music echo reduction
- Auto-shutdown: Sender stops after timeout set by receiver (manual, no auto default)

## Visual States

| State | Sender | Receiver |
|-------|--------|----------|
| Connected | Green background | Green background |
| Disconnected | Red/black blink | Red/black overlay "CONNECTION LOST" |
| Loud sound | - | Red/black overlay "LOUD SOUND DETECTED" |
| PTT active | Blue pulsing "👂 Parent is speaking..." | - |
| Music playing | Purple pulsing "🎵 [track name]" | Track name + timer |
| Shutdown active | Orange "🌙 Shutdown in H:MM:SS" | Orange info strip + countdown in drawer |
| Screen dim | Black overlay after 5s | - |

## Implementation Details

- Wake Lock API keeps screens on (with auto-shutdown timer)
- Auto-shutdown configured by receiver (manual; supports minutes/hours/seconds, uses short options when ENABLE_DEBUG_TIMER=true)
- Relay mode is selected on the start page and preserved via `transport=relay` on sender URLs; receivers learn it automatically from the active session
- In relay mode the server keeps one sender-facing and one receiver-facing peer connection per receiver
- AudioContext analyzes volume for loud sound detection
- Sensitivity slider controls threshold (saved to localStorage)
- Volume control persisted to localStorage (boost >100% routes audio through Web Audio and may break Bluetooth)
- Screen dims on sender after 5s inactivity to save battery
- Echo cancellation uses FFT-based spectral subtraction via ScriptProcessorNode
  - Inline Radix-2 Cooley-Tukey FFT (no external dependencies)
  - 2048-sample FFT with 50% overlap (1024 hop size)
  - Per-frequency-bin subtraction: `outputMag = max(micMag - α*musicMag, β*micMag)`
  - Temporal smoothing reduces "musical noise" artifacts
  - Automatic fallback to simple mode if device too slow (10 overruns)
  - Parameters: ALPHA=2.0 (over-subtraction), BETA=0.02 (floor), SMOOTHING=0.6
- `createMediaElementSource` is called once per audio element (limitation)
- `RTCRtpSender.replaceTrack()` swaps between raw/processed audio without renegotiation

## API Endpoints

- `GET /api/sse/sender/:session` - SSE stream for sender in session
- `GET /api/sse/receiver/:session` - SSE stream for receivers in session
- `POST /api/signal` - WebRTC signaling (requires `session` in body, stripped before forwarding)
- `GET /api/webrtc-config?transport=direct|relay` - JSON ICE config for client WebRTC setup
- `GET /api/status/:session` - JSON: `{senderActive, receiverCount}` for specific session
- `GET /api/status` - JSON: `{activeSessions, totalReceivers}` for global status
- `GET /api/music?playlist=1` - JSON: `{files: [{name, url}], playlists: ["1","2"], currentPlaylist, debugTimer}`

## Signal Types

Signaling messages sent via `/api/signal`:

| Signal | Direction | Description |
|--------|-----------|-------------|
| `request-offer` | Receiver → Sender | Request WebRTC offer |
| `video-request` | Receiver → Sender | Toggle video on/off |
| `offer` | Sender → Receivers | WebRTC offer |
| `answer` | Receiver → Sender | WebRTC answer |
| `ice-candidate` | Both directions | ICE candidate exchange |
| `ptt-start` | Receiver → Sender | PTT starting |
| `ptt-offer` | Receiver → Sender | PTT renegotiation offer (legacy, ignored) |
| `ptt-answer` | Sender → Receivers | PTT renegotiation answer (legacy, ignored) |
| `ptt-stop` | Receiver → Sender | PTT stopped |
| `music-start` | Receiver → Sender | Start music playback |
| `music-stop` | Receiver → Sender | Stop music playback |
| `music-timer-reset` | Receiver → Sender | Reset music timer |
| `music-status` | Sender → Receivers | Music playback status |
| `echo-cancel-enable` | Receiver → Sender | Toggle spectral subtraction |
| `echo-cancel-status` | Sender → Receivers | Echo cancel status (enabled, active) |
| `shutdown-timeout` | Receiver → Sender | Set auto-shutdown timeout (value, unit) |
| `shutdown-now` | Receiver → Sender | Trigger immediate 30s shutdown countdown |
| `shutdown-status` | Sender → Receivers | Shutdown timer status (active, remainingMs) |

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
- `/s/{session}?q=sd` - SD quality mode (default is HD)
- `/s/{session}?transport=relay` - Force server relay instead of direct peer-to-peer
- `/receiver` - Landing page with session prompt
- `/r/{session}` - Receiver page for specific session (bookmarkable)
- `/r/{session}?transport=relay` - Legacy/manual receiver override; normally detected automatically from the sender session
- Short paths (`/s/`, `/r/`) avoid conflicts with static files on some hosting setups
- Session name stored in `localStorage` for convenience

## When Making Changes

1. Keep the main app framework-free; only add focused dependencies when architecture truly requires them (for example the server-side relay bridge)
2. No WebSockets - use SSE + HTTP POST
3. No data storage - direct mode is peer-to-peer; relay mode only forwards packets and does not persist media
4. Test on mobile browsers (Chrome Android recommended)
5. HTTPS required for camera/mic in production
6. CSS is in separate files, not inline
7. **Update documentation on significant changes:**
   - `CLAUDE.md` - Update this file for dev context changes
   - `.github/copilot-instructions.md` - Keep in sync with CLAUDE.md
   - `README.md` - Update for user-facing feature changes
8. **Trigger server restart:** After making changes, update the `// Wisdom:` comment at the end of `server.js` with a new random sentence of wisdom. This triggers nodemon to restart the server.
