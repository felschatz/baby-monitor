# Baby Monitor

A real-time baby monitor web application for streaming audio and video between two phones. Place one phone near your baby and watch/listen from the other. Works on Android and iOS over local network or internet. Supports direct WebRTC and optional server-relayed WebRTC for restrictive networks. Talk back to the baby supported. No data storage.

## Features

- **Session-based isolation** - Multiple monitors on one server, each with unique session name
- **Bookmarkable URLs** - URLs like `/sender/my-session` work every day without prompts
- **Real-time streaming** - Low-latency direct or server-relayed video and audio
- **Optional server relay mode** - Start page can force a built-in server relay when direct WebRTC is blocked
- **Push-to-talk (PTT)** - Talk back to your baby from the parent's phone
- **Audio ducking** - Automatically lowers baby audio during PTT to prevent echo
- **No data storage** - Media is never recorded or stored on the server, even in relay mode
- **Screen wake lock** - Keeps both devices awake while monitoring
- **Visual alerts**:
  - 🟢 Green background when connected
  - 🔴 Red/black flashing overlay with "LOUD SOUND DETECTED" on loud sounds
  - 🔴 Red/black flashing overlay with "CONNECTION LOST" on disconnect
- **Sender screen dimming** - Screen turns black after 5 seconds to save battery, tap to wake
- **Audio level meter** - Visual indicator with threshold marker on receiver
- **Adjustable sensitivity** - Control when loud sound alerts trigger
- **Volume control** - Adjust playback volume on receiver (settings persist)
- **Fullscreen mode** - Immersive viewing on receiver
- **Auto-reconnect** - Automatically reconnects when connection is lost
- **Lullaby playback** - Play music on baby's phone with configurable sleep timer
- **Music echo reduction** (Experimental) - Reduces music bleedthrough in the audio stream using spectral subtraction
- **No WebSocket required** - Uses Server-Sent Events (SSE) for signaling, works with simple hosting

## Requirements

- Node.js 21.7.x or higher
- Two devices with modern browsers (Chrome, Firefox, Safari, Edge)
- Camera and microphone permissions
- HTTPS for production (required for camera/mic access on non-localhost)

## Installation

```bash
# Clone or download the project
git clone https://github.com/felschatz/baby-monitor.git
cd baby-monitor

# Install dependencies
npm install

# Start the server
npm start
```

The server runs on `http://localhost:3000` by default.

## Usage

### 1. Start the Server

```bash
npm start
```

### 2. First Time Setup

1. Navigate to `http://<server-ip>:3000/`
2. Enter a session name (e.g., "felix-baby") - use the same name for sender and receiver
3. Choose **Direct** or **Server Relay** on the start page for the sender session
4. Click **"Baby's Phone (Sender)"** or **"Parent's Phone (Receiver)"**
5. **Bookmark the URL** (e.g., `/sender/felix-baby`) for easy daily access

### 3. Daily Use (After Bookmarking)

1. Open your bookmarked sender URL on the baby's phone
2. Open your bookmarked receiver URL on your phone
3. Streaming starts automatically - no need to enter session name again

### 4. Sender Setup (Baby's Device)

1. Navigate to `http://<server-ip>:3000/s/<session-name>` (or use bookmark)
2. Allow camera and microphone access when prompted
3. Select video/audio options (both enabled by default)
4. Streaming auto-starts when connected
5. Screen will dim after 5 seconds of inactivity - tap to wake

### 5. Receiver Setup (Parent's Device)

1. Navigate to `http://<server-ip>:3000/r/<session-name>` (or use bookmark)
2. The stream connects automatically when sender is available
3. **Tap anywhere** to enable audio (required by browser autoplay policies)
4. Adjust volume and alert sensitivity as needed
5. **Hold the 🎤 button** to talk to baby (Push-to-Talk)

### Landing Page

Navigate to `http://<server-ip>:3000/` for a status page showing active sessions and the session input form.

## Deployment

### Server Requirements

- Node.js 21.x runtime
- HTTPS certificate (required for camera/microphone access)
- SSE support (standard HTTP, no WebSocket upgrade needed)
- Open ports for normal HTTPS traffic and browser WebRTC connectivity to the server
- Relay mode is built into the Node app; no separate TURN service is required

### Deploy with FTP (GitHub Actions)

This project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) for automated FTPS deployment on push to `main`.

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `FTP_SERVER` | FTP server hostname |
| `FTP_USERNAME` | FTP username |
| `FTP_PASSWORD` | FTP password |
| `FTP_SERVER_DIR` | Target directory on server |

### Running on a Server

After deploying files, SSH into your server and:

```bash
cd /path/to/baby-monitor

# Install dependencies
npm install --production

# Start with PM2 (recommended for production)
pm2 start server.js --name baby-monitor

# Or run directly
node server.js
```

### Reverse Proxy (Nginx)

Example Nginx configuration with SSE support:

```nginx
server {
    listen 443 ssl http2;
    server_name baby-monitor.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # SSE support - disable buffering
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
    }
}
```

### Session Security

Sessions provide access control through secret session names:
- Session names are never broadcast - only used server-side for routing
- Unknown session name = cannot access the stream
- Use a strong session name (8+ random characters) for privacy
- Sessions are not enumerable - other users can't discover your sessions

### Password Protection (Optional)

For additional security, you can add password protection at the web server level:

#### Nginx

```nginx
location / {
    auth_basic "Baby Monitor";
    auth_basic_user_file /path/to/.htpasswd;

    proxy_pass http://localhost:3000;
    # ... other proxy settings
}
```

Create `.htpasswd`:

```bash
htpasswd -c /path/to/.htpasswd username
```

#### Apache (.htaccess)

```apache
AuthType Basic
AuthName "Baby Monitor"
AuthUserFile /path/to/.htpasswd
Require valid-user
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `ENABLE_DEBUG_TIMER` | Show 1-minute timer option for testing | `false` |
Relay mode is built in when the server has the `@roamhq/wrtc` dependency installed.

## Project Structure

```
baby-monitor/
├── server.js                  # Thin wrapper, starts the server
├── server/                    # Server modules (ES6/CommonJS)
│   ├── index.js               # HTTP server, main router
│   ├── session-manager.js     # Session state management
│   ├── sse-manager.js         # SSE setup and broadcast
│   ├── signal-router.js       # WebRTC signaling handlers
│   ├── music-api.js           # Playlist scanning
│   ├── relay-manager.js       # Server-side WebRTC relay bridge + client RTC config
│   ├── static-server.js       # Static file serving
│   └── utils.js               # Shared utilities
├── package.json               # Project config
├── AGENT.md                   # AI assistant context file
├── README.md                  # This file
├── mp3/                       # Lullaby MP3 files (add your own)
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions FTPS deployment
└── public/
    ├── index.html             # Landing page with status
    ├── sender.html            # Baby's phone UI
    ├── sender.css             # Sender styles
    ├── receiver.html          # Parent's phone UI
    ├── receiver.css           # Receiver styles
    └── js/                    # Frontend modules (ES6)
        ├── sender-app.js      # Sender main orchestration
        ├── receiver-app.js    # Receiver main orchestration
        ├── keep-awake.js      # Wake lock, NoSleep
        ├── session.js         # Session handling
        ├── signaling.js       # SSE connection
        ├── webrtc.js          # WebRTC utilities
        ├── screen-dimming.js  # Sender screen dimming
        ├── music-player.js    # Lullaby playback
        ├── echo-cancellation.js # FFT spectral subtraction
        ├── sender-webrtc.js   # Sender WebRTC logic
        ├── audio-analysis.js  # Volume detection
        ├── video-playback.js  # Autoplay handling
        ├── ptt.js             # Push-to-talk
        └── receiver-webrtc.js # Receiver WebRTC logic
```

## Visual Indicators

### Receiver (Parent's Phone)

| State | Indicator |
|-------|-----------|
| Connected | Green background |
| Disconnected | Red/black flashing overlay: "CONNECTION LOST" |
| Loud sound | Red/black flashing overlay: "LOUD SOUND DETECTED" |
| Audio meter | Bar with white threshold marker showing current level |
| Music playing | Track name and time remaining under music button |

### Sender (Baby's Phone)

| State | Indicator |
|-------|-----------|
| Connected | Green background |
| Disconnected | Red/black flashing background |
| Streaming | Camera preview visible |
| Screen saving | Black overlay after 5s (tap to wake) |
| Parent talking | Blue pulsing indicator: "🔊 Parent is speaking..." |
| Music playing | Purple pulsing indicator: "🎵 [track name]" with timer |

## Controls

### Receiver (Parent's Phone)

| Control | Function |
|---------|----------|
| 🎤 Button | Hold to talk to baby (Push-to-Talk) |
| 🎵 Button | Toggle lullaby playback on baby's phone |
| Timer dropdown | Select sleep timer duration (45 min, 1 hour, 1:45, 2 hours; default 2 hours) |
| Volume slider | Adjust playback volume (saved to localStorage) |
| Sensitivity slider | Adjust loud sound threshold (saved to localStorage) |
| Audio only checkbox | Disable video to save bandwidth |
| Reduce music echo checkbox | Experimental: reduce music in audio stream |
| ⛶ Fullscreen | Toggle fullscreen mode |

### Sender (Baby's Phone)

| Control | Function |
|---------|----------|
| Video checkbox | Enable/disable video streaming |
| Audio checkbox | Enable/disable audio streaming |
| Start/Stop button | Begin or end streaming |

## How It Works

### Architecture

1. **Signaling Server** - Pure Node.js HTTP server uses Server-Sent Events (SSE) for connection setup
2. **Peer-to-Peer Streaming** - Direct connection between devices for lowest-latency media
3. **STUN Servers** - Public servers help browsers gather usable ICE candidates
4. **Optional Server Relay** - The Node server can bridge media through paired WebRTC peer connections when direct paths fail

### Connection Flow

1. Sender connects to `/api/sse/sender/:session` (SSE endpoint)
2. Receiver connects to `/api/sse/receiver/:session` (SSE endpoint)
3. Receiver requests connection via `/api/signal` with `session` in body
4. Server routes messages only within the same session
5. Sender creates offer and sends via signal endpoint
6. Receiver responds with answer
7. ICE candidates are exchanged
8. Direct or server-relayed media connection established

### Relay Mode

If you choose **Server Relay** on the sender side, the app keeps WebRTC but replaces the direct browser-to-browser path with two browser-to-server peer connections. The Node server bridges sender media to each receiver and also bridges the PTT return audio back to the sender. Receivers learn the correct transport mode automatically from the active sender session before requesting an offer.

### Push-to-Talk Flow

1. Parent holds 🎤 button on receiver
2. Receiver adds audio track and renegotiates connection
3. Sender receives audio and plays through speaker
4. Parent releases button, track is removed

### Lullaby Playback

1. Add MP3 files to playlist folders under `mp3/` (e.g., `mp3/1/`, `mp3/2/`, etc.)
2. Select a playlist from the dropdown (both sender and receiver remember your choice)
3. Parent taps 🎵 button and selects timer duration
4. Sender shuffles playlist and plays through speaker
5. Music stops automatically when timer expires
6. Parent can stop manually by tapping the stop button

### Music Echo Reduction (Experimental)

When lullabies are playing on the baby's phone, the music can bleed through the microphone into the audio stream. The "Reduce music echo" feature attempts to reduce this:

1. Enable "Reduce music echo" checkbox on receiver
2. Start music playback
3. Sender analyzes both the music and microphone audio using FFT
4. Music frequencies are attenuated from the mic signal before streaming
5. Baby sounds should still come through while music is reduced

**Note:** This is experimental. Results vary depending on speaker/mic placement and room acoustics. The feature uses ScriptProcessorNode (deprecated but widely supported) for real-time processing.

**Playlist Structure:**
```
mp3/
├── 1/                    # Playlist 1 (default)
│   ├── name.txt          # Contains "German Lullabies"
│   ├── lullaby.mp3
│   └── twinkle.mp3
├── 2/                    # Playlist 2
│   ├── name.txt          # Contains "Lofi Hiphop"
│   ├── ocean.mp3
│   └── rain.mp3
└── 3/                    # Playlist 3
    └── white_noise.mp3   # No name.txt = "Playlist 3"
```

Add a `name.txt` file to each folder to give it a custom display name.

## Privacy & Security

- **No data storage** - Video/audio is never recorded or persisted on the server
- **Direct mode** - Only public STUN servers are contacted for NAT traversal
- **Relay mode** - Media goes through the built-in server relay on your infrastructure
- **STUN servers used in direct mode**:
  - `stun.stunprotocol.org:3478`
  - `stun.nextcloud.com:443`
  - `stun.sipgate.net:3478`
- **Always use HTTPS** - Required for camera/mic access and prevents eavesdropping
- **Always password protect** - Prevent unauthorized access to your baby's stream

## Troubleshooting

### Sender phone turns off or sleeps

The app uses multiple keep-awake mechanisms (Wake Lock API, background video, silent audio), but Android can still kill apps aggressively. For reliable overnight monitoring:

**Required settings on the sender (baby's) phone:**

1. **Disable battery optimization for Chrome**
   - Settings → Apps → Chrome → Battery → "Unrestricted" (not "Optimized")
   - This prevents Android from killing Chrome in the background

2. **Disable auto power-off**
   - Settings → Battery → Auto power off → OFF
   - Some phones have scheduled shutdown - disable it

3. **Lock the app in recent apps**
   - Open recent apps (swipe up or square button)
   - Find Chrome, tap the lock icon or long-press → "Lock"
   - This prevents the app from being killed when memory is low

4. **Keep the phone plugged in**
   - Use a reliable charger and cable
   - Some cheap cables disconnect intermittently

5. **Disable "Adaptive battery"** (optional but recommended)
   - Settings → Battery → Adaptive battery → OFF
   - This feature learns to kill "unused" apps

**For Samsung phones:**
- Also disable "Put unused apps to sleep" in Device Care → Battery

**For Xiaomi/MIUI:**
- Settings → Battery → App battery saver → Chrome → "No restrictions"
- Also check Security app → Permissions → Autostart → enable Chrome

### Camera/Microphone not working

- Ensure you've granted permissions in browser settings
- HTTPS is required for media access on mobile (localhost is exempt for testing)
- Try a different browser (Chrome recommended)
- Check if another app is using the camera

### Connection not establishing

1. Check browser console (F12) for errors
2. Ensure both devices can reach the server
3. Try refreshing both pages (sender first, then receiver)
4. Verify STUN servers are accessible (not blocked by firewall)
5. If direct peer-to-peer is blocked, switch the start page to **Server Relay**
6. Ensure the browser can still reach your Node server for WebRTC traffic

### No audio on parent talk-back (PTT)

1. On sender (baby's phone), tap the screen to enable audio playback
2. Check browser console for "PTT" related logs
3. Ensure microphone permission granted on parent's phone
4. Try releasing and pressing the PTT button again

### Audio plays through speaker instead of headphones

WebRTC audio is classified as "communication audio" by mobile browsers, which may route to the speaker even with headphones connected.

1. **Check phone audio settings** - Look for call/communication audio routing options in Settings → Sound
2. **For Bluetooth headphones** - Ensure both "Media audio" AND "Phone audio" are enabled in the Bluetooth device settings
3. **Try wired headphones** - They often have more reliable audio routing than Bluetooth

### Loud sound alerts not working

1. Tap anywhere on the receiver page first (enables AudioContext)
2. Check the white threshold marker on the audio meter
3. Adjust sensitivity slider - higher value = more sensitive (lower threshold)
4. Check browser console for "Loud sound detected" logs

### Video not showing / black screen

1. Check sender is streaming (green background, preview visible)
2. Tap the receiver screen to enable video playback
3. Check browser console for track and connection state logs
4. Try disabling hardware acceleration in browser

### High latency

- WebRTC provides low latency, but network conditions matter
- Try disabling video for audio-only monitoring
- Check your internet connection speed on both devices
- Ensure devices are on the same network for best results

## Technology Stack

- **Backend**: Node.js 21.x (pure http module, no frameworks)
- **Frontend**: Vanilla JavaScript, WebRTC API
- **Signaling**: Server-Sent Events (SSE) + HTTP POST
- **NAT Traversal**: STUN (public servers) + optional built-in server-side WebRTC relay
- **Deployment**: GitHub Actions with FTPS

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page with session input |
| `/api/webrtc-config` | GET | Returns direct or relay WebRTC ICE configuration |
| `/sender` | GET | Sender page (shows session prompt) |
| `/s/:session` | GET | Sender page for specific session |
| `/receiver` | GET | Receiver page (shows session prompt) |
| `/r/:session` | GET | Receiver page for specific session |
| `/api/status` | GET | Global status (activeSessions, totalReceivers) |
| `/api/status/:session` | GET | Session status (senderActive, receiverCount) |
| `/api/sse/sender/:session` | GET | SSE endpoint for sender in session |
| `/api/sse/receiver/:session` | GET | SSE endpoint for receivers in session |
| `/api/signal` | POST | Signaling (requires session in body) |
| `/api/music` | GET | List available MP3 files and debug timer setting |

## Contributing

Contributions are welcome! This project is open source and we appreciate help from the community.

### How to Contribute

1. **Report bugs** - Open an issue describing the problem and how to reproduce it
2. **Suggest features** - Open an issue with your idea (check existing issues first)
3. **Submit PRs** - Fork the repo, make your changes, and submit a pull request
4. **Improve docs** - Fix typos, clarify instructions, add examples

### Development Setup

```bash
git clone https://github.com/felschatz/baby-monitor.git
cd baby-monitor
npm install
npm run dev  # Uses nodemon for auto-restart
```

### Guidelines

- Keep it simple - this project has zero framework dependencies
- Test on mobile - most users are on phones
- No WebSockets - we use SSE for signaling
- Update docs if you change behavior

See [open issues](https://github.com/felschatz/baby-monitor/issues) for feature ideas and bugs that need help.

## License

ISC
