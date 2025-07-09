// Central API router that mounts all sub-routers
const express = require('express');
const router = express.Router();
const path = require('path');

// Import individual API route handlers
const createProducerTransport = require('../../api/transports/createProducerTransport');
const createConsumerTransport = require('../../api/transports/createConsumerTransport');
const connectTransport = require('../../api/transports/connectTransport');
const produce = require('../../api/transports/produce');
const consume = require('../../api/transports/consume');

const createPipeTransport = require('../../api/pipe-transports/create');
const connectPipeTransport = require('../../api/pipe-transports/connect');
const producePipe = require('../../api/pipe-transports/produce');
const consumePipe = require('../../api/pipe-transports/consume');

const createRoom = require('../../api/rooms/createRoom');
const joinRoom = require('../../api/rooms/joinRoom');
const getRoomInfo = require('../../api/rooms/getRoomInfo');
const deleteRoom = require('../../api/rooms/deleteRoom');

const getStats = require('../../api/stats/getStats');

const createStream = require('../../api/streams/createStream');
const getStreams = require('../../api/streams/getStreams');

const getProducers = require('../../api/producers/index');

// Import signaling API handler
const signalingApi = require('./signaling');

module.exports = (dependencies) => {
  // Mount signaling API routes
  router.use('/signaling', signalingApi(dependencies));

  // Router RTP capabilities
  router.get('/router-rtp-capabilities', (req, res) => {
    res.json(dependencies.router.rtpCapabilities);
  });

  // Health check endpoint
  router.get('/health', (req, res) => {
    const nodeId = req.nodeId || 'unknown';
    
    try {
      // Get system metrics
      const cpuUsage = process.cpuUsage();
      const memUsage = process.memoryUsage();
      
      // Calculate CPU percentage (simplified)
      const cpuPercent = Math.min(100, (cpuUsage.user + cpuUsage.system) / 10000);
      
      // Calculate memory percentage
      const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      // Get connection count from peer manager
      const connections = dependencies.peerManager ? dependencies.peerManager.getActivePeerCount() : 0;
      
      // Get router info
      const routerInfo = dependencies.router ? {
        id: dependencies.router.id,
        closed: dependencies.router.closed
      } : null;
      
      // Get transport counts
      const transportCounts = dependencies.transportManager ? {
        producers: dependencies.transportManager.getProducerCount(),
        consumers: dependencies.transportManager.getConsumerCount(),
        transports: dependencies.transportManager.getTransportCount()
      } : {};
      
      const healthData = {
        nodeId,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        cpu: Math.round(cpuPercent * 100) / 100,
        memory: Math.round(memPercent * 100) / 100,
        connections,
        router: routerInfo,
        transports: transportCounts,
        system: {
          platform: process.platform,
          version: process.version,
          pid: process.pid,
          memoryUsage: memUsage
        }
      };
      
      res.json(healthData);
    } catch (error) {
      console.error('❌ Health check error:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // SFU node registration (from signaling server)
  router.post('/register-sfu', (req, res) => {
    const { nodeId, port, capabilities } = req.body;
    
    dependencies.metricsManager.addSfuNode(nodeId, {
      port,
      capabilities,
      connections: 0,
      status: 'active'
    });
    
    console.log(`✅ SFU Node registered: ${nodeId} on port ${port}`);
    
    // Broadcast to monitoring dashboard if websocket available
    if (dependencies.webSocketHandler) {
      dependencies.webSocketHandler.broadcastToAll('sfu-registered', { nodeId, port, capabilities });
    }
    
    res.json({ success: true, nodeId });
  });

  // Smart SFU node selection for multi-node streaming
  router.post('/select-sfu-node', (req, res) => {
    try {
      const { streamId, operation, excludeNodes = [] } = req.body;
      
      const selectedNode = dependencies.metricsManager.selectBestSfuNode(excludeNodes);
      
      if (!selectedNode) {
        return res.status(503).json({ error: 'No SFU nodes available' });
      }
      
      res.json({
        nodeId: selectedNode.nodeId,
        host: 'localhost',
        port: selectedNode.port,
        capabilities: selectedNode.capabilities
      });
    } catch (error) {
      console.error('Error selecting SFU node:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Legacy endpoints for backward compatibility
  router.post('/create-transport', (req, res) => {
    const { type } = req.body;
    if (type === 'producer') {
      return createProducerTransport(dependencies)(req, res);
    } else if (type === 'consumer') {
      return createConsumerTransport(dependencies)(req, res);
    } else {
      return res.status(400).json({ error: 'Invalid transport type' });
    }
  });

  router.post('/connect-transport', connectTransport(dependencies));
  router.post('/produce', produce(dependencies));
  router.post('/consume', consume(dependencies));

  // Modern transport endpoints
  router.post('/transports/producer', createProducerTransport(dependencies));
  router.post('/transports/consumer', createConsumerTransport(dependencies));
  router.post('/transports/connect', connectTransport(dependencies));
  router.post('/transports/produce', produce(dependencies));
  router.post('/transports/consume', consume(dependencies));

  // Pipe transport endpoints
  router.post('/pipe-transports/create', createPipeTransport(dependencies.transportManager, dependencies.routerManager));
  router.post('/pipe-transports/:transportId/connect', connectPipeTransport(dependencies.transportManager));
  router.post('/pipe-transports/:transportId/produce', producePipe(dependencies.transportManager));
  router.post('/pipe-transports/:transportId/consume', consumePipe(dependencies));

  // Room management endpoints
  router.get('/rooms', (req, res) => {
    try {
      const rooms = dependencies.roomManager.getAllRooms();
      res.json(rooms);
    } catch (error) {
      console.error('Error getting rooms:', error);
      res.status(500).json({ error: error.message });
    }
  });
  router.post('/rooms/create', createRoom(dependencies));
  router.post('/rooms/join', joinRoom(dependencies));
  router.get('/rooms/:roomId', getRoomInfo(dependencies));
  router.delete('/rooms/:roomId', deleteRoom(dependencies));

  // Statistics endpoints
  router.get('/stats', getStats(dependencies));
  router.get('/stats/node', (req, res) => {
    const metrics = dependencies.metricsManager.getMetrics();
    res.json(metrics.nodeStats);
  });

  router.get('/stats/transport', (req, res) => {
    const metrics = dependencies.metricsManager.getMetrics();
    res.json(metrics.transportStats);
  });

  router.get('/stats/router', (req, res) => {
    const metrics = dependencies.metricsManager.getMetrics();
    res.json(metrics.routerStats);
  });

  // Node information endpoint
  router.get('/info', (req, res) => {
    const metrics = dependencies.metricsManager.getMetrics();
    const streams = dependencies.streamManager || dependencies.roomManager || new Map();
    
    res.json({
      nodeId: dependencies.metricsManager.nodeId,
      port: dependencies.metricsManager.port,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      streams: streams.size || 0,
      rooms: dependencies.roomManager?.size || 0,
      transports: metrics.transportStats?.total || 0,
      producers: metrics.transportStats?.producers || 0,
      consumers: metrics.transportStats?.consumers || 0,
      timestamp: new Date().toISOString()
    });
  });

  // Stream management endpoints
  router.post('/streams/create', createStream(dependencies.streams, dependencies.metricsManager));
  router.get('/streams', getStreams(dependencies));

  // Producer management endpoints
  router.get('/producers', getProducers(dependencies));

  // Cluster coordinator endpoints (moved from cluster-coordinator.js)
  router.get('/nodes', (req, res) => {
    const nodes = dependencies.clusterCoordinator ? 
      dependencies.clusterCoordinator.getNodes() : 
      dependencies.metricsManager.getAllSfuNodes();
    res.json(nodes);
  });

  // WebSocket client count
  router.get('/clients', (req, res) => {
    const clientCount = dependencies.webSocketHandler ? 
      dependencies.webSocketHandler.getClientCount() : 0;
    res.json({ count: clientCount });
  });

  // Peer management endpoints
  router.get('/peers', (req, res) => {
    const peers = dependencies.peerManager.getAllPeers();
    res.json(peers);
  });

  router.get('/peers/stats', (req, res) => {
    const stats = dependencies.peerManager.getConnectionStats();
    res.json(stats);
  });

  // Stream mapping endpoints
  router.get('/stream-mappings', (req, res) => {
    const mappings = dependencies.peerManager.getAllStreamMappings();
    res.json(mappings);
  });

  // MediaSoup client bundle (from web-server.js)
  router.get('/mediasoup-client.js', (req, res) => {
    res.type('application/javascript');
    res.send(`
// Simple MediaSoup Client wrapper with robust error handling
window.mediasoupClient = {
  Device: class Device {
    constructor() {
      this.loaded = false;
      this.rtpCapabilities = null;
      this._id = 'device_' + Math.random().toString(36).substr(2, 9);
      console.log(\`📱 MediaSoup Device created: \${this._id}\`);
    }
    
    async load(options) {
      try {
        if (!options || !options.routerRtpCapabilities) {
          throw new Error('Invalid router RTP capabilities');
        }
        
        this.rtpCapabilities = options.routerRtpCapabilities;
        this.loaded = true;
        console.log(\`📱 MediaSoup device loaded successfully: \${this._id}\`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(\`❌ Device load failed: \${error.message}\`);
        throw error;
      }
    }
    
    canProduce(kind) {
      if (!this.loaded) {
        console.warn(\`⚠️ Device not loaded, cannot produce \${kind}\`);
        return false;
      }
      return kind === 'video' || kind === 'audio';
    }
    
    async createSendTransport(transportOptions) {
      if (!this.loaded) {
        throw new Error('Device not loaded');
      }
      
      return new SendTransport(transportOptions);
    }
    
    async createRecvTransport(transportOptions) {
      if (!this.loaded) {
        throw new Error('Device not loaded');
      }
      
      return new RecvTransport(transportOptions);
    }
  },
  
  // Mock transport classes for testing
  SendTransport: class SendTransport {
    constructor(options) {
      this.id = options.id;
      this.iceParameters = options.iceParameters;
      this.iceCandidates = options.iceCandidates;
      this.dtlsParameters = options.dtlsParameters;
      this.closed = false;
    }
    
    async produce(options) {
      if (this.closed) throw new Error('Transport closed');
      return new Producer(options);
    }
    
    close() {
      this.closed = true;
    }
  },
  
  RecvTransport: class RecvTransport {
    constructor(options) {
      this.id = options.id;
      this.iceParameters = options.iceParameters;
      this.iceCandidates = options.iceCandidates;
      this.dtlsParameters = options.dtlsParameters;
      this.closed = false;
    }
    
    async consume(options) {
      if (this.closed) throw new Error('Transport closed');
      return new Consumer(options);
    }
    
    close() {
      this.closed = true;
    }
  }
};

// Mock Producer and Consumer classes
class Producer {
  constructor(options) {
    this.id = 'producer_' + Math.random().toString(36).substr(2, 9);
    this.kind = options.kind;
    this.track = options.track;
    this.closed = false;
  }
  
  close() {
    this.closed = true;
  }
}

class Consumer {
  constructor(options) {
    this.id = options.id;
    this.kind = options.kind;
    this.rtpParameters = options.rtpParameters;
    this.closed = false;
  }
  
  close() {
    this.closed = true;
  }
}
`);
  });

  return router;
};
