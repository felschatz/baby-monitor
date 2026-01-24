# Baby Monitor

A real-time baby monitor web application using WebRTC for peer-to-peer audio/video streaming between two devices.

## Features

- **Real-time streaming** - Low-latency video and audio via WebRTC
- **Push-to-talk** - Talk back to your baby from the parent's phone
- **No data storage** - All streaming is peer-to-peer, nothing is recorded or stored
- **Screen wake lock** - Keeps both devices awake while monitoring
- **Visual alerts**:
  - Green background when connected
  - Red flashing overlay with "LOUD SOUND DETECTED" on loud sounds
  - Red flashing overlay with "CONNECTION LOST" on disconnect
- **Sender screen dimming** - Screen turns black after 5 seconds to save battery, tap to wake
- **Audio level meter** - Visual indicator with threshold marker
- **Adjustable sensitivity** - Control when loud sound alerts trigger
- **Volume control** - Adjust playback volume on receiver
- **Fullscreen mode** - Immersive viewing on receiver

## Requirements

- Node.js 21.7.x or higher
- Two devices with modern browsers (Chrome, Firefox, Safari, Edge)
- Camera and microphone permissions
- HTTPS for production (required for camera/mic access)

## Installation

```bash
# Clone or download the project
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

- Navigate to `http://<server-ip>:3000/sender`
- Allow camera and microphone access
- Select video/audio options
- Click **"Start Streaming"**
- **Tap the orange hint** to enable talk-back audio from parent

### 3. Open Receiver (Parent's Device)

- Navigate to `http://<server-ip>:3000/receiver`
- The stream will connect automatically
- **Tap anywhere** to enable audio (required by browsers)
- Adjust volume and alert sensitivity as needed
- **Hold the 🎤 button** to talk to baby

## Deployment

### Server Requirements

- Node.js 21.x runtime
- HTTPS certificate (required for camera/microphone access)
- WebSocket support
- Open ports for WebRTC (or use STUN/TURN servers)

### Deploy with FTP

This project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) for automated FTP deployment.

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

# Start with PM2 (recommended)
pm2 start server.js --name baby-monitor

# Or run directly
node server.js
```

### Reverse Proxy (Nginx)

Example Nginx configuration:

```nginx
server {
    listen 443 ssl http2;
    server_name baby-monitor.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $websocket_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Password Protection (.htaccess)

**Important:** Since this app streams your baby's video, always password protect it!

#### Apache (.htaccess)

Create `.htaccess` in your web root:

```apache
AuthType Basic
AuthName "Baby Monitor"
AuthUserFile /path/to/.htpasswd
Require valid-user

# Allow WebSocket upgrade
RewriteEngine On
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^(.*)$ ws://localhost:3000/$1 [P,L]
```

Create `.htpasswd`:

```bash
htpasswd -c /path/to/.htpasswd username
```

#### Nginx

```nginx
location / {
    auth_basic "Baby Monitor";
    auth_basic_user_file /path/to/.htpasswd;

    proxy_pass http://localhost:3000;
    # ... other proxy settings
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |

## Project Structure

```
baby-monitor/
├── server.js              # Node.js server with WebSocket signaling
├── package.json           # Project dependencies
├── .github/
│   └── workflows/
│       └── deploy.yml     # GitHub Actions FTP deployment
└── public/
    ├── index.html         # Landing page
    ├── sender.html        # Baby's phone (camera/mic sender)
    └── receiver.html      # Parent's phone (viewer)
```

## Visual Indicators

### Receiver (Parent's Phone)

| State | Indicator |
|-------|-----------|
| Connected | Green background |
| Disconnected | Red/black flashing overlay: "CONNECTION LOST" |
| Loud sound | Red/black flashing overlay: "LOUD SOUND DETECTED" |
| Audio meter | Green/yellow/red bar with white threshold marker |

### Sender (Baby's Phone)

| State | Indicator |
|-------|-----------|
| Connected | Green background |
| Streaming | Camera preview visible |
| Screen saving | Black screen (tap to wake) |
| Parent talking | Blue pulsing overlay: "Parent is speaking..." |

## Controls

### Receiver (Parent's Phone)

| Control | Function |
|---------|----------|
| 🎤 Button | Hold to talk to baby |
| Volume slider | Adjust playback volume |
| Sensitivity slider | Adjust loud sound threshold (white marker shows level) |
| Fullscreen button | Toggle fullscreen mode |

### Sender (Baby's Phone)

| Control | Function |
|---------|----------|
| Video checkbox | Enable/disable video |
| Audio checkbox | Enable/disable audio |
| Start/Stop button | Begin or end streaming |

## Privacy & Security

- **No data storage** - Video/audio streams peer-to-peer, never stored
- **No external services** - Only STUN servers are contacted (for NAT traversal)
- **STUN servers used** - stunprotocol.org, nextcloud.com, sipgate.net (only see IP addresses, not media)
- **Always use HTTPS** - Prevents eavesdropping
- **Always password protect** - Prevent unauthorized access

## Troubleshooting

### Camera/Microphone not working

- Ensure you've granted permissions in browser settings
- HTTPS is required for media access on mobile (localhost is exempt)
- Try a different browser

### Connection not establishing

1. Check browser console (F12) for errors
2. Ensure both devices can reach the server
3. Try refreshing both pages
4. Check that sender has clicked "Start Streaming"
5. Verify STUN servers are accessible (not blocked by firewall)

### No audio on parent talk-back

1. On baby's phone, tap the orange "enable audio" hint
2. Check browser console for PTT-related logs
3. Ensure microphone permission granted on parent's phone

### Loud sound alerts not working

1. Tap anywhere on the receiver page first (enables AudioContext)
2. Check the white threshold marker on the audio meter
3. Adjust sensitivity slider (higher = more sensitive)
4. Check browser console for "Loud sound detected" logs

### High latency

- WebRTC provides low latency, but network conditions matter
- Try disabling video for audio-only monitoring
- Check your internet connection speed

## Technology Stack

- **Backend**: Node.js, Express, ws (WebSocket)
- **Frontend**: Vanilla JavaScript, WebRTC API
- **Signaling**: WebSocket for offer/answer/ICE candidate exchange
- **Streaming**: WebRTC peer-to-peer
- **NAT Traversal**: STUN (stunprotocol.org, nextcloud.com, sipgate.net)

## License

ISC
