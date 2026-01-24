# Baby Monitor

A real-time baby monitor web application using WebRTC for peer-to-peer audio/video streaming between two devices.

## Features

- **Real-time streaming** - Low-latency video and audio via WebRTC
- **No data storage** - All streaming is peer-to-peer, nothing is recorded or stored
- **Screen wake lock** - Keeps both devices awake while monitoring
- **Visual alerts**:
  - Green background when connected
  - Black/white flashing on loud sounds (adjustable sensitivity)
  - Red/black flashing on disconnect
- **Sender screen dimming** - Screen turns black after 5 seconds to save battery, tap to wake
- **Audio level meter** - Visual indicator of sound levels on both devices
- **Volume control** - Adjust playback volume on receiver
- **Fullscreen mode** - Immersive viewing on receiver

## Requirements

- Node.js 21.7.x or higher
- Two devices with modern browsers (Chrome, Firefox, Safari, Edge)
- Camera and microphone permissions

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

### 3. Open Receiver (Parent's Device)

- Navigate to `http://<server-ip>:3000/receiver`
- The stream will connect automatically
- Adjust volume and alert sensitivity as needed

## Network Setup

### Local Network (Same WiFi)

1. Find your computer's local IP address:
   - Windows: `ipconfig`
   - Mac/Linux: `ifconfig` or `ip addr`
2. Access via `http://<local-ip>:3000` on both phones

### Remote Access (Different Networks)

For use over the internet, you'll need to:

1. **Use a tunneling service** like [ngrok](https://ngrok.com):
   ```bash
   ngrok http 3000
   ```

2. **Or deploy to a hosting service** (Heroku, Railway, Render, etc.)

**Note:** HTTPS is required for camera/microphone access on mobile browsers (except localhost).

## Project Structure

```
baby-monitor/
├── server.js           # Node.js server with WebSocket signaling
├── package.json        # Project dependencies
└── public/
    ├── index.html      # Landing page
    ├── sender.html     # Baby's phone (camera/mic sender)
    └── receiver.html   # Parent's phone (viewer)
```

## Visual Indicators

| State | Background Color |
|-------|-----------------|
| Connected | Green |
| Disconnected | Red/Black flashing |
| Loud sound detected | White/Black flashing |
| Idle (sender) | Black (after 5 seconds) |

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)

### Receiver Controls

- **Volume slider** - Adjust audio playback volume
- **Sensitivity slider** - Adjust loud sound detection threshold (higher = more sensitive)
- **Fullscreen button** - Toggle fullscreen mode

## Troubleshooting

### Camera/Microphone not working

- Ensure you've granted permissions in browser settings
- HTTPS is required for media access on mobile (use ngrok or deploy with SSL)

### Connection not establishing

1. Check browser console (F12) for errors
2. Ensure both devices are on the same network or server is publicly accessible
3. Try refreshing both pages
4. Check that sender has clicked "Start Streaming"

### High latency

- WebRTC should provide low latency, but network conditions affect quality
- Try reducing video quality or disabling video for audio-only monitoring

## Technology Stack

- **Backend**: Node.js, Express, ws (WebSocket)
- **Frontend**: Vanilla JavaScript, WebRTC API
- **Signaling**: WebSocket for offer/answer/ICE candidate exchange
- **Streaming**: WebRTC peer-to-peer

## License

ISC
