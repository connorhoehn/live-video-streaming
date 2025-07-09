const express = require('express');
const cors = require('cors');
const path = require('path');
const mediasoup = require('mediasoup');

// Core components
const ClusterCoordinator = require('./core/ClusterCoordinator');
const WebServer = require('./core/WebServer');

// Managers
const PeerManager = require('./managers/PeerManager');
const MetricsManager = require('./managers/MetricsManager');
const RoomManager = require('./managers/RoomManager');
const TransportManager = require('./managers/TransportManager');
const RouterManager = require('./managers/RouterManager');

// Services
const RedisMeshState = require('./services/redis-mesh-state');

// Utils and handlers
const { makeHttpRequest } = require('./utils/http');
const MeshCoordinator = require('./mesh/index');
const WebSocketHandler = require('./websocket/index');
const apiRoutes = require('./handlers/api/index');

class Application {
  constructor() {
    this.config = this.loadConfig();
    this.dependencies = {};
    this.servers = {};
    this.isInitialized = false;
  }

  loadConfig() {
    return {
      nodeId: process.env.NODE_ID || 'sfu1',
      sfuPort: parseInt(process.env.PORT) || 3001,
      webPort: parseInt(process.env.WEB_PORT) || 2020,
      coordinatorPort: parseInt(process.env.COORDINATOR_PORT) || 4000,
      host: process.env.HOST || 'localhost',
      coordinatorUrl: process.env.COORDINATOR_URL || 'http://localhost:4000',
      signalingUrl: process.env.SIGNALING_SERVER || 'http://localhost:3000',
      mediasoupLogLevel: process.env.DEBUG ? 'debug' : 'warn',
      mediasoupAnnouncedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1'
    };
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log(`🚀 Initializing application ${this.config.nodeId}...`);
      
      // Initialize MediaSoup
      await this.initializeMediaSoup();
      
      // Initialize managers
      this.initializeManagers();
      
      // Initialize services
      await this.initializeServices();
      
      // Initialize mesh coordination
      await this.initializeMeshCoordination();
      
      // Initialize servers
      await this.initializeServers();
      
      // Register with cluster coordinator
      await this.registerWithCluster();
      
      this.isInitialized = true;
      console.log(`✅ Application ${this.config.nodeId} initialized successfully`);
      
    } catch (error) {
      console.error('❌ Application initialization failed:', error);
      throw error;
    }
  }

  async initializeMediaSoup() {
    const portOffset = (this.config.sfuPort - 3000) * 1000;
    const mediasoupConfig = {
      worker: {
        rtcMinPort: Math.max(10000 + portOffset, 10000),
        rtcMaxPort: Math.min(10000 + portOffset + 999, 65535),
        logLevel: this.config.mediasoupLogLevel,
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp']
      },
      router: {
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: { 'x-google-start-bitrate': 1000 }
          },
          {
            kind: 'video',
            mimeType: 'video/VP9',
            clockRate: 90000,
            parameters: { 'profile-id': 2, 'x-google-start-bitrate': 1000 }
          },
          {
            kind: 'video',
            mimeType: 'video/h264',
            clockRate: 90000,
            parameters: {
              'packetization-mode': 1,
              'profile-level-id': '4d0032',
              'level-asymmetry-allowed': 1,
              'x-google-start-bitrate': 1000
            }
          }
        ]
      },
      webRtcTransport: {
        listenIps: [
          {
            ip: '0.0.0.0',
            announcedIp: this.config.mediasoupAnnouncedIp
          }
        ],
        maxIncomingBitrate: 1500000,
        initialAvailableOutgoingBitrate: 1000000,
        minimumAvailableOutgoingBitrate: 600000,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      }
    };

    // Create MediaSoup worker
    this.dependencies.worker = await mediasoup.createWorker(mediasoupConfig.worker);
    
    // Create router
    this.dependencies.router = await this.dependencies.worker.createRouter({
      mediaCodecs: mediasoupConfig.router.mediaCodecs
    });
    
    this.dependencies.mediasoupConfig = mediasoupConfig;
    
    console.log(`📡 MediaSoup worker and router created for ${this.config.nodeId}`);
  }

  initializeManagers() {
    this.dependencies.peerManager = new PeerManager();
    this.dependencies.metricsManager = new MetricsManager(this.config.nodeId);
    this.dependencies.clusterCoordinator = new ClusterCoordinator();
    
    // Initialize streams collection
    this.dependencies.streams = new Map();
    
    console.log('📊 Managers initialized');
  }

  async initializeServices() {
    // Initialize Redis mesh state
    this.dependencies.redisMesh = new RedisMeshState({
      nodeId: this.config.nodeId,
      redisUrl: 'redis://localhost:6377'
    });
    
    try {
      await this.dependencies.redisMesh.connect();
      // Clear old state for this node on startup
      await this.dependencies.redisMesh.clearNodeState();
      console.log('✅ Redis mesh state connected');
    } catch (error) {
      console.warn('⚠️  Redis mesh state connection failed:', error.message);
    }
    
    this.dependencies.roomManager = new RoomManager();
    this.dependencies.transportManager = new TransportManager(
      this.dependencies.router,
      this.dependencies.mediasoupConfig
    );
    this.dependencies.routerManager = new RouterManager(
      [this.dependencies.worker], // Pass as array
      this.dependencies.mediasoupConfig
    );
    
    // Register the main router with the RouterManager
    await this.dependencies.routerManager.addRouter(this.dependencies.router, {
      isDefault: true,
      workerId: this.dependencies.worker.pid
    });
    
    console.log('🔧 Services initialized');
  }

  async initializeMeshCoordination() {
    this.dependencies.meshCoordinator = new MeshCoordinator(
      this.config.nodeId,
      this.config.coordinatorUrl,
      this.config.signalingUrl
    );
    
    console.log('🌐 Mesh coordination initialized');
  }

  async initializeServers() {
    // Create SFU server
    const sfuApp = express();
    sfuApp.use(cors());
    sfuApp.use(express.json());
    
    // Mount API routes
    sfuApp.use('/api', apiRoutes({
      ...this.dependencies,
      nodeId: this.config.nodeId
    }));
    
    // Add dependency injection for routes
    this.dependencies.nodeId = this.config.nodeId;
    
    this.servers.sfuServer = sfuApp.listen(this.config.sfuPort, () => {
      console.log(`🚀 SFU server running on port ${this.config.sfuPort}`);
    });
    
    // Initialize WebSocket handler
    this.dependencies.webSocketHandler = new WebSocketHandler(
      this.servers.sfuServer,
      this.dependencies
    );
    this.dependencies.webSocketHandler.initialize();
    
    // Create web server only on coordinator node
    if (this.config.nodeId === 'coordinator' || process.env.IS_COORDINATOR === 'true') {
      this.servers.webServer = new WebServer({
        port: this.config.webPort,
        coordinatorUrl: this.config.coordinatorUrl
      });
      await this.servers.webServer.start();
      
      // Create cluster coordinator server
      await this.startClusterCoordinator();
    }
  }

  async startClusterCoordinator() {
    const coordinatorApp = express();
    coordinatorApp.use(cors());
    coordinatorApp.use(express.json());
    
    // Import and use coordinator API handler
    const coordinatorApiHandler = require('./handlers/api/coordinator');
    coordinatorApp.use('/api', coordinatorApiHandler(this.dependencies.clusterCoordinator));
    
    this.servers.coordinatorServer = coordinatorApp.listen(this.config.coordinatorPort, () => {
      console.log(`🎯 Cluster Coordinator running on port ${this.config.coordinatorPort}`);
    });
  }

  async registerWithCluster() {
    if (this.config.nodeId !== 'coordinator') {
      try {
        await this.dependencies.meshCoordinator.registerWithCoordinator({
          host: this.config.host,
          port: this.config.sfuPort,
          capacity: 100
        });
        
        await this.dependencies.meshCoordinator.registerWithSignaling({
          port: this.config.sfuPort,
          capabilities: {
            audio: true,
            video: true,
            recording: false
          }
        });
        
        // Start periodic stats reporting
        this.startStatsReporting();
        
      } catch (error) {
        console.warn('⚠️ Failed to register with cluster:', error.message);
      }
    }
  }

  startStatsReporting() {
    setInterval(async () => {
      try {
        const stats = {
          load: this.dependencies.metricsManager.getMetrics().nodeStats.load,
          rooms: this.dependencies.roomManager.getAllRooms().length,
          participants: this.dependencies.peerManager.getAllPeers().length
        };
        
        await this.dependencies.meshCoordinator.updateStats(stats);
        
        // Also update node status in Redis
        if (this.dependencies.redisMesh && this.dependencies.redisMesh.connected) {
          await this.dependencies.redisMesh.updateNodeStatus({
            id: this.config.nodeId,
            host: this.config.host,
            port: this.config.sfuPort,
            rooms: stats.rooms,
            participants: stats.participants
          });
        }
      } catch (error) {
        console.error('❌ Failed to report stats:', error.message);
      }
    }, 5000);
  }

  async shutdown() {
    console.log('🛑 Shutting down application...');
    
    // Disconnect from Redis
    if (this.dependencies.redisMesh) {
      await this.dependencies.redisMesh.disconnect();
    }
    
    // Close MediaSoup worker
    if (this.dependencies.worker) {
      this.dependencies.worker.close();
    }
    
    // Close servers
    Object.values(this.servers).forEach(server => {
      if (server && server.close) {
        server.close();
      }
    });
    
    if (this.servers.webServer) {
      await this.servers.webServer.stop();
    }
    
    console.log('✅ Application shutdown complete');
  }

  getDependencies() {
    return this.dependencies;
  }

  getServers() {
    return this.servers;
  }
}

module.exports = Application;
