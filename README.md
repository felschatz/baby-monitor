# Baby Monitor

A real-time baby monitor web application using WebRTC for peer-to-peer audio/video streaming between two devices. Designed for use with two phones (Android/iOS) over a local network or the internet.

## Features

- **Real-time streaming** - Low-latency video and audio via WebRTC peer-to-peer
- **Push-to-talk (PTT)** - Talk back to your baby from the parent's phone
- **Audio ducking** - Automatically lowers baby audio during PTT to prevent echo
- **No data storage** - All streaming is peer-to-peer, nothing is recorded or stored on the server
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

### 2. Open Sender (Baby's Device)

1. Navigate to `http://<server-ip>:3000/sender`
2. Allow camera and microphone access when prompted
3. Select video/audio options (both enabled by default)
4. Click **"Start Streaming"** (auto-starts when connected)
5. Screen will dim after 5 seconds of inactivity - tap to wake

### 3. Open Receiver (Parent's Device)

1. Navigate to `http://<server-ip>:3000/receiver`
2. The stream connects automatically when sender is available
3. **Tap anywhere** to enable audio (required by browser autoplay policies)
4. Adjust volume and alert sensitivity as needed
5. **Hold the 🎤 button** to talk to baby (Push-to-Talk)

### Landing Page

Navigate to `http://<server-ip>:3000/` for a status page showing whether a stream is active and links to both sender and receiver pages.

## Deployment

### Server Requirements

- Node.js 21.x runtime
- HTTPS certificate (required for camera/microphone access)
- SSE support (standard HTTP, no WebSocket upgrade needed)
- Open ports for WebRTC media (or configure TURN servers for restrictive NATs)

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

### Password Protection

**Important:** Since this app streams your baby's video, always password protect it in production!

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

## Project Structure

```
baby-monitor/
├── server.js              # Express server with SSE signaling
├── package.json           # Project dependencies (Express only)
├── CLAUDE.md              # AI assistant context file
├── README.md              # This file
├── .github/
│   └── workflows/
│       └── deploy.yml     # GitHub Actions FTPS deployment
└── public/
    ├── index.html         # Landing page with status
    ├── sender.html        # Baby's phone (camera/mic sender)
    ├── sender.css         # Sender styles
    ├── receiver.html      # Parent's phone (viewer)
    └── receiver.css       # Receiver styles
```

## Visual Indicators

### Receiver (Parent's Phone)

| State | Indicator |
|-------|-----------|
| Connected | Green background |
| Disconnected | Red/black flashing overlay: "CONNECTION LOST" |
| Loud sound | Red/black flashing overlay: "LOUD SOUND DETECTED" |
| Audio meter | Bar with white threshold marker showing current level |

### Sender (Baby's Phone)

| State | Indicator |
|-------|-----------|
| Connected | Green background |
| Disconnected | Red/black flashing background |
| Streaming | Camera preview visible |
| Screen saving | Black overlay after 5s (tap to wake) |
| Parent talking | Blue pulsing indicator: "🔊 Parent is speaking..." |

## Controls

### Receiver (Parent's Phone)

| Control | Function |
|---------|----------|
| 🎤 Button | Hold to talk to baby (Push-to-Talk) |
| Volume slider | Adjust playback volume (saved to localStorage) |
| Sensitivity slider | Adjust loud sound threshold (saved to localStorage) |
| ⛶ Fullscreen | Toggle fullscreen mode |

### Sender (Baby's Phone)

| Control | Function |
|---------|----------|
| Video checkbox | Enable/disable video streaming |
| Audio checkbox | Enable/disable audio streaming |
| Start/Stop button | Begin or end streaming |

## How It Works

### Architecture

1. **Signaling Server** - Express.js server uses Server-Sent Events (SSE) for signaling
2. **WebRTC** - Peer-to-peer connection for low-latency media streaming
3. **STUN Servers** - Public STUN servers for NAT traversal (no TURN by default)

### Connection Flow

1. Sender connects to `/api/sse/sender` (SSE endpoint)
2. Receiver connects to `/api/sse/receiver` (SSE endpoint)
3. Receiver requests offer via `/api/signal` (HTTP POST)
4. Sender creates WebRTC offer and sends via signal endpoint
5. Receiver responds with answer
6. ICE candidates are exchanged
7. Direct peer-to-peer media connection established

### Push-to-Talk Flow

1. Parent holds 🎤 button on receiver
2. Receiver adds audio track and renegotiates connection
3. Sender receives audio and plays through speaker
4. Parent releases button, track is removed

## Privacy & Security

- **No data storage** - Video/audio streams peer-to-peer, server only handles signaling
- **No external services** - Only STUN servers are contacted (for NAT traversal)
- **STUN servers used**:
  - `stun.stunprotocol.org:3478`
  - `stun.nextcloud.com:443`
  - `stun.sipgate.net:3478`
- **Always use HTTPS** - Required for camera/mic access and prevents eavesdropping
- **Always password protect** - Prevent unauthorized access to your baby's stream

## Troubleshooting

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
5. If behind strict NAT, you may need a TURN server

### No audio on parent talk-back (PTT)

1. On sender (baby's phone), tap the screen to enable audio playback
2. Check browser console for "PTT" related logs
3. Ensure microphone permission granted on parent's phone
4. Try releasing and pressing the PTT button again

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

- **Backend**: Node.js 21.x, Express 5.x
- **Frontend**: Vanilla JavaScript (no framework dependencies)
- **Signaling**: Server-Sent Events (SSE) + HTTP POST
- **Streaming**: WebRTC (RTCPeerConnection API)
- **NAT Traversal**: STUN (public servers)
- **Deployment**: GitHub Actions with FTPS

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page |
| `/sender` | GET | Sender page (baby's device) |
| `/receiver` | GET | Receiver page (parent's device) |
| `/api/status` | GET | JSON status (senderActive, receiverCount) |
| `/api/sse/sender` | GET | SSE endpoint for sender |
| `/api/sse/receiver` | GET | SSE endpoint for receivers |
| `/api/signal` | POST | WebRTC signaling (offers, answers, ICE candidates) |

## License

ISC
