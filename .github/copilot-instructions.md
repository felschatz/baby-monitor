# Baby Monitor - Copilot Instructions

## Project Overview

Real-time baby monitor web app using WebRTC for peer-to-peer streaming between two phones.
- **Sender** (`/sender`) - Baby's phone with camera/mic
- **Receiver** (`/receiver`) - Parent's phone viewing stream

## Tech Stack

- **Runtime**: Node.js 21.7.x
- **Server**: Express 5.x (single dependency)
- **Signaling**: Server-Sent Events (SSE) + HTTP POST (no WebSockets)
- **Streaming**: WebRTC (RTCPeerConnection)
- **Frontend**: Vanilla JS, no frameworks

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express server, SSE endpoints, signaling |
| `public/sender.html` | Camera/mic capture, WebRTC offer creation |
| `public/receiver.html` | Stream playback, PTT, audio analysis |
| `public/*.css` | Separate stylesheets for sender/receiver |

## Architecture Notes

- SSE used instead of WebSockets for simpler hosting compatibility
- Single sender, multiple receivers supported
- PTT (Push-to-Talk) works via WebRTC renegotiation
- Audio ducking reduces baby audio to 15% during PTT
- STUN servers: stunprotocol.org, nextcloud.com, sipgate.net

## API Endpoints

- `GET /api/sse/sender` - SSE stream for sender
- `GET /api/sse/receiver` - SSE stream for receivers
- `POST /api/signal` - WebRTC signaling (offers, answers, ICE)
- `GET /api/status` - JSON: `{senderActive, receiverCount}`
- `GET /api/music` - JSON: `{files: [{name, url}], debugTimer}`

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
