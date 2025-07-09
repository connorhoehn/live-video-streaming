# MediaSoup Multi-Node Live Video Streaming

A distributed SFU (Selective Forwarding Unit) system built with MediaSoup, featuring three SFU nodes, real-time monitoring, and a web-based testing interface.

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Signaling     │    │   Web Client    │    │   Dashboard     │
│   Server        │◄──►│   (Publisher/   │◄──►│   Monitoring    │
│   (Port 3000)   │    │   Subscriber)   │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SFU Node 1    │    │   SFU Node 2    │    │   SFU Node 3    │
│   (Port 3001)   │    │   (Port 3002)   │    │   (Port 3003)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn
- Modern web browser with WebRTC support

### Installation & Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start all servers:**
   ```bash
   npm start
   ```

3. **Open the dashboard:**
   Open http://localhost:3000 in your browser

## 📋 Available Scripts

### Main Scripts
- `npm start` - Start all servers (signaling + 3 SFU nodes)
- `npm run dev` - Start in development mode with auto-restart
- `npm run signaling` - Start only the signaling server
- `npm run sfu1` - Start SFU node 1 (port 3001)
- `npm run sfu2` - Start SFU node 2 (port 3002)  
- `npm run sfu3` - Start SFU node 3 (port 3003)

### Development Utilities
```bash
# Use the development script for common tasks
./scripts/dev.sh [command]

# Available commands:
./scripts/dev.sh install     # Install dependencies
./scripts/dev.sh start       # Start all servers
./scripts/dev.sh status      # Check server status
./scripts/dev.sh logs        # View logs
./scripts/dev.sh stop        # Stop all servers
./scripts/dev.sh clean       # Clean up everything
```

## 🎮 Using the Dashboard

### Publishing a Stream
1. Click "📤 Start Publishing" to begin streaming your camera/microphone
2. The system will automatically assign you to the least loaded SFU node
3. Your video will appear in the "Local Video" section

### Subscribing to a Stream  
1. Once a stream is being published, click "📥 Start Viewing"
2. The system will connect you to the appropriate SFU node
3. The remote video will appear in the "Remote Video" section

### Monitoring
- **SFU Nodes**: Real-time status of all three SFU servers
- **Active Connections**: Live view of publisher/subscriber connections
- **System Logs**: Real-time activity logs from all components

## 🔧 System Components

### Signaling Server (Port 3000)
- Manages SFU node registration and discovery
- Routes clients to appropriate SFU nodes  
- Provides load balancing across nodes
- Serves the web dashboard interface
- Real-time monitoring and statistics

### SFU Nodes (Ports 3001-3003)
- MediaSoup-based selective forwarding units
- Handle WebRTC transport creation and management
- Process media streams (produce/consume)
- Report statistics back to signaling server
- Independent scaling and fault tolerance

### Web Dashboard
- Real-time monitoring interface
- Stream testing capabilities
- Connection visualization
- System logs and statistics
- Responsive design for mobile/desktop

## 📊 Monitoring & Logging

### Real-time Statistics
- Active connections per SFU node
- Stream distribution across nodes
- Connection assignments and routing
- System health and performance

### Log Levels
Each component provides detailed logging:
- 🟢 **Info**: General operations and connections
- 🟡 **Warn**: Non-critical issues and fallbacks  
- 🔴 **Error**: Critical failures and exceptions
- 🔵 **Debug**: Detailed MediaSoup operations

### API Endpoints

#### Signaling Server (Port 3000)
- `GET /api/sfu-nodes` - List active SFU nodes
- `POST /api/register-sfu` - SFU node registration
- `POST /api/heartbeat/:nodeId` - SFU health updates

#### SFU Nodes (Ports 3001-3003)
- `GET /api/router-rtp-capabilities` - MediaSoup RTP capabilities
- `POST /api/create-transport` - Create WebRTC transport
- `POST /api/connect-transport` - Connect transport with DTLS
- `POST /api/produce` - Create producer for media stream
- `POST /api/consume` - Create consumer for media stream
- `GET /api/stats` - Node statistics and health

## 🔀 Load Balancing & Routing

### Publisher Assignment
- Round-robin distribution across available SFU nodes
- Considers current connection load per node
- Automatic failover to backup nodes

### Subscriber Routing  
- Prefers SFU node that has the requested stream
- Falls back to least loaded node for load distribution
- Supports cross-node stream routing (future enhancement)

## 🛠️ Development & Testing

### Adding New Features
1. Modify the appropriate component (signaling/sfu/dashboard)
2. Use `npm run dev` for auto-restart during development
3. Monitor logs with `./scripts/dev.sh logs [filter]`
4. Test with multiple browser tabs/windows

### Testing Scenarios
- **Single Node**: Start only one SFU node to test basic functionality
- **Multi-Node**: Start all nodes to test load balancing
- **Failover**: Stop nodes during streaming to test resilience
- **Load Testing**: Open multiple browser tabs for concurrent streams

### Debugging
- Use browser DevTools for client-side WebRTC debugging
- Check server logs for MediaSoup-specific issues
- Monitor network tab for API call failures
- Use `./scripts/dev.sh status` for quick health checks

## 📈 Performance Considerations

### Recommended Limits
- **Connections per SFU node**: 50-100 concurrent
- **Streams per node**: 20-50 simultaneous  
- **Video quality**: Adaptive based on network conditions
- **Audio quality**: Opus codec at 48kHz

### Scaling Options
- Add more SFU nodes by copying the configuration
- Implement database persistence for larger deployments
- Add Redis for distributed session management
- Use Docker for containerized deployment

## 🔐 Security Notes

### Current Implementation
- **Development only**: No authentication or encryption
- **Local network**: Designed for localhost testing
- **No TURN**: Direct P2P connections only

### Production Considerations
- Add JWT-based authentication
- Implement HTTPS/WSS for secure connections
- Deploy TURN servers for NAT traversal
- Add rate limiting and DDoS protection
- Implement user management and permissions

## 🐛 Troubleshooting

### Common Issues

**"No SFU nodes available"**
- Check that all SFU servers are running
- Verify network connectivity to ports 3001-3003
- Check server logs for startup errors

**WebRTC connection fails**
- Ensure browser has camera/microphone permissions
- Check if HTTPS is required (some browsers)
- Verify firewall allows WebRTC traffic

**Video not displaying**
- Check browser console for JavaScript errors
- Verify MediaSoup client library loaded correctly
- Confirm WebRTC transports are connected

**High CPU usage**
- Reduce video resolution/framerate
- Check for memory leaks in long-running sessions
- Monitor MediaSoup worker processes

### Debug Commands
```bash
# Check if all servers are responding
./scripts/dev.sh status

# View filtered logs
./scripts/dev.sh logs sfu1
./scripts/dev.sh logs ERROR

# Restart specific components
npm run sfu1
npm run signaling
```

## 🚧 Future Enhancements

- [ ] Cross-node stream routing for better load distribution
- [ ] Recording and playback capabilities  
- [ ] Screen sharing support
- [ ] Mobile app integration
- [ ] Kubernetes deployment configuration
- [ ] Metrics dashboard with Grafana
- [ ] Automated testing suite
- [ ] User authentication and room management
- [ ] TURN server integration for production use

## 📝 License

MIT License - see LICENSE file for details

---

**Happy Streaming! 🎥**
# live-video-streaming
