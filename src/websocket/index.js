const socketIo = require('socket.io');
const roomEvents = require('./events/roomEvents');
const webrtcEvents = require('./events/webrtcEvents');

class WebSocketHandler {
  constructor(server, dependencies) {
    this.server = server;
    this.dependencies = dependencies;
    this.io = null;
    this.connectedClients = new Map();
    
    // Extract dependencies
    this.roomManager = dependencies.roomManager;
    this.transportManager = dependencies.transportManager;
    this.routerManager = dependencies.routerManager;
    this.peerManager = dependencies.peerManager;
    this.metricsManager = dependencies.metricsManager;
    this.meshCoordinator = dependencies.meshCoordinator;
    this.router = dependencies.router;
  }

  initialize() {
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Setup event handlers
    this.setupEventHandlers();
    
    console.log('🔌 WebSocket server initialized');
    return this.io;
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);
      
      // Add to peer manager
      this.peerManager.addConnection(socket.id, {
        remoteAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date()
      });

      // Register room events
      const roomEventHandlers = roomEvents(
        this.roomManager,
        this.routerManager,
        this.router,
        this.dependencies.nodeId
      );
      
      // Register WebRTC events
      const webrtcEventHandlers = webrtcEvents(
        this.transportManager,
        this.roomManager,
        this.routerManager,
        this.router,
        this.peerManager,
        this.dependencies
      );

      // Register all event handlers
      this.registerEventHandlers(socket, roomEventHandlers);
      this.registerEventHandlers(socket, webrtcEventHandlers);

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        this.handleDisconnect(socket);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error(`🔌 Socket error for ${socket.id}:`, error);
      });
    });
  }

  registerEventHandlers(socket, handlers) {
    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, (...args) => {
        // Extract callback if present
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const data = args[0];
        
        try {
          if (callback) {
            handler(socket, data, callback);
          } else {
            handler(socket, data);
          }
        } catch (error) {
          console.error(`❌ Error handling ${event}:`, error);
          if (callback) {
            callback({ error: error.message });
          } else {
            socket.emit('error', { message: error.message });
          }
        }
      });
    });
  }

  handleDisconnect(socket) {
    const peer = this.peerManager.getPeer(socket.id);
    if (peer) {
      // Clean up peer resources
      this.peerManager.cleanupPeerResources(
        socket.id,
        this.transportManager.transports,
        this.transportManager.producers,
        this.transportManager.consumers
      );
      
      // Remove from rooms
      peer.rooms.forEach(roomId => {
        this.roomManager.removeParticipant(roomId, socket.id);
        socket.to(`room:${roomId}`).emit('participant-left', {
          roomId,
          participantId: socket.id
        });
      });
      
      // Remove peer
      this.peerManager.removePeer(socket.id);
      this.peerManager.removeConnection(socket.id);
    }
    
    this.connectedClients.delete(socket.id);
  }

  // Utility methods for broadcasting
  broadcastToRoom(roomId, event, data) {
    this.io.to(`room:${roomId}`).emit(event, data);
  }

  broadcastToAll(event, data) {
    this.io.emit(event, data);
  }

  sendToClient(socketId, event, data) {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
    }
  }

  getConnectedClients() {
    return Array.from(this.connectedClients.values());
  }

  getClientCount() {
    return this.io.sockets.sockets.size;
  }
}

module.exports = WebSocketHandler;
