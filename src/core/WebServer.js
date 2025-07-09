const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { makeHttpRequest } = require('../utils/http');

class WebServer {
  constructor(config) {
    this.port = config.port || 2020;
    this.coordinatorUrl = config.coordinatorUrl || 'http://localhost:4000';
    this.app = express();
    this.server = null;
    this.io = null;
    this.sfuNodes = new Map(); // Track available SFU nodes
    this.nodeHealth = new Map(); // Track node health/load
    this.clientConnections = new Map(); // Track client -> SFU node mapping
    this.loadBalancer = {
      roundRobin: 0,
      weights: new Map(), // Node capacity weights
      connectionCounts: new Map() // Current connections per node
    };
    this.maxConnectionsPerNode = config.maxConnectionsPerNode || 10000; // Max users per SFU node
    this.healthCheckInterval = config.healthCheckInterval || 30000; // 30 seconds
    
    this.setupMiddleware();
    this.setupRoutes();
    this.startHealthChecks();
  }

  setupMiddleware() {
    // Enable CORS
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // Serve public files directly (without /public prefix)
    this.app.use(express.static(path.join(__dirname, '../../public')));
    
    // Proxy requests to coordinator
    this.app.use('/api/coordinator', (req, res) => {
      const coordinatorUrl = new URL(req.url, this.coordinatorUrl);
      const options = {
        hostname: coordinatorUrl.hostname,
        port: coordinatorUrl.port,
        path: coordinatorUrl.pathname + coordinatorUrl.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: coordinatorUrl.host
        }
      };
      
      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      
      proxyReq.on('error', (error) => {
        console.error('Proxy error:', error);
        res.status(500).send('Proxy error: ' + error.message);
      });
      
      if (req.body) {
        proxyReq.write(JSON.stringify(req.body));
      }
      
      req.pipe(proxyReq, { end: true });
    });

    // Serve test pages and assets (main streaming interface)
    this.app.use('/test', express.static(path.join(__dirname, '../../test')));

    // Serve dashboard files from public/js for API calls only
    this.app.use('/js', express.static(path.join(__dirname, '../../public/js')));

    // Serve Socket.IO client from node_modules
    this.app.use('/socket.io', express.static(path.join(__dirname, '../../node_modules/socket.io/client-dist')));

    // Serve MediaSoup client from node_modules
    this.app.use('/mediasoup-client', express.static(path.join(__dirname, '../../node_modules/mediasoup-client/lib')));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'web-server',
        timestamp: new Date().toISOString()
      });
    });

    // Default route for SPA
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    // Catch-all route for client-side routing
    this.app.get('*', (req, res) => {
      // Check if the request is for a file (has extension)
      if (path.extname(req.path)) {
        return res.status(404).send('File not found');
      }
      
      // Otherwise, serve the main index.html for client-side routing
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      
      // Setup Socket.IO
      this.io = new Server(this.server, {
        cors: {
          origin: "*",
          methods: ["GET", "POST"]
        },
        // Optimize for high concurrency
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling'],
        allowEIO3: true
      });
      
      this.setupSocketIO();
      this.setupLoadBalancingEndpoint();
      
      this.server.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`🌐 Web server running on port ${this.port}`);
          console.log(`📊 Max connections per SFU node: ${this.maxConnectionsPerNode}`);
          console.log(`🎯 Total capacity: ${this.maxConnectionsPerNode * this.sfuNodes.size} connections`);
          this.discoverSFUNodes();
          resolve(this.server);
        }
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🌐 Web server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getApp() {
    return this.app;
  }

  getServer() {
    return this.server;
  }

  startHealthChecks() {
    // Initial health check
    this.performHealthChecks();
    
    // Set up periodic health checks
    setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  async performHealthChecks() {
    for (const [nodeId, node] of this.sfuNodes) {
      try {
        const startTime = Date.now();
        const response = await makeHttpRequest({
          hostname: node.host,
          port: node.port,
          path: '/api/health',
          method: 'GET',
          timeout: 5000 // 5 second timeout
        });
        
        const responseTime = Date.now() - startTime;
        const healthData = JSON.parse(response);
        
        // Calculate node capacity weight based on performance
        const weight = this.calculateNodeWeight(healthData, responseTime);
        
        this.nodeHealth.set(nodeId, {
          status: 'healthy',
          cpu: healthData.cpu || 0,
          memory: healthData.memory || 0,
          connections: healthData.connections || 0,
          responseTime,
          lastCheck: Date.now(),
          ...healthData
        });
        
        this.loadBalancer.weights.set(nodeId, weight);
        
        console.log(`✅ Health check passed for ${nodeId}: CPU=${healthData.cpu}%, Memory=${healthData.memory}%, RT=${responseTime}ms`);
        
      } catch (error) {
        console.error(`❌ Health check failed for ${nodeId}:`, error.message);
        this.nodeHealth.set(nodeId, {
          status: 'unhealthy',
          lastCheck: Date.now(),
          error: error.message
        });
        
        // Reduce weight for unhealthy nodes
        this.loadBalancer.weights.set(nodeId, 0);
      }
    }
  }

  calculateNodeWeight(healthData, responseTime) {
    // Higher weight = higher capacity
    // Base weight of 1, adjusted by performance metrics
    let weight = 1;
    
    // CPU factor (lower CPU = higher weight)
    const cpuFactor = Math.max(0.1, 1 - (healthData.cpu || 0) / 100);
    weight *= cpuFactor;
    
    // Memory factor (lower memory = higher weight)
    const memoryFactor = Math.max(0.1, 1 - (healthData.memory || 0) / 100);
    weight *= memoryFactor;
    
    // Response time factor (lower response time = higher weight)
    const responseTimeFactor = Math.max(0.1, 1 - Math.min(responseTime / 1000, 1));
    weight *= responseTimeFactor;
    
    // Connection factor (fewer connections = higher weight)
    const connections = healthData.connections || 0;
    const connectionFactor = Math.max(0.1, 1 - connections / this.maxConnectionsPerNode);
    weight *= connectionFactor;
    
    return Math.round(weight * 100) / 100; // Round to 2 decimal places
  }

  // Enhanced connection tracking
  trackConnection(socketId, sfuNodeId) {
    this.clientConnections.set(socketId, sfuNodeId);
    
    // Update connection count
    const currentCount = this.loadBalancer.connectionCounts.get(sfuNodeId) || 0;
    this.loadBalancer.connectionCounts.set(sfuNodeId, currentCount + 1);
    
    console.log(`📊 Connection tracked: ${socketId} -> ${sfuNodeId} (${currentCount + 1} total)`);
  }

  untrackConnection(socketId) {
    const sfuNodeId = this.clientConnections.get(socketId);
    if (sfuNodeId) {
      this.clientConnections.delete(socketId);
      
      // Update connection count
      const currentCount = this.loadBalancer.connectionCounts.get(sfuNodeId) || 0;
      this.loadBalancer.connectionCounts.set(sfuNodeId, Math.max(0, currentCount - 1));
      
      console.log(`📊 Connection untracked: ${socketId} -> ${sfuNodeId} (${Math.max(0, currentCount - 1)} total)`);
    }
  }

  // Get load balancing stats
  getLoadBalancingStats() {
    const stats = {
      totalConnections: this.clientConnections.size,
      nodeStats: []
    };
    
    for (const [nodeId, node] of this.sfuNodes) {
      const health = this.nodeHealth.get(nodeId);
      const connections = this.loadBalancer.connectionCounts.get(nodeId) || 0;
      const weight = this.loadBalancer.weights.get(nodeId) || 0;
      
      stats.nodeStats.push({
        nodeId,
        host: node.host,
        port: node.port,
        connections,
        maxConnections: this.maxConnectionsPerNode,
        utilization: (connections / this.maxConnectionsPerNode * 100).toFixed(2) + '%',
        weight,
        health: health ? {
          status: health.status,
          cpu: health.cpu,
          memory: health.memory,
          responseTime: health.responseTime
        } : null
      });
    }
    
    return stats;
  }

  // Add load balancing endpoint
  setupLoadBalancingEndpoint() {
    this.app.get('/api/load-balancing-stats', (req, res) => {
      res.json(this.getLoadBalancingStats());
    });
  }

  // Enhanced Socket.IO setup with connection limits
  setupSocketIO() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);
      
      // Check global connection limit
      if (this.clientConnections.size >= this.maxConnectionsPerNode * this.sfuNodes.size) {
        console.error('❌ Global connection limit reached');
        socket.emit('error', { message: 'Server capacity reached. Please try again later.' });
        socket.disconnect();
        return;
      }
      
      // Assign client to a SFU node using intelligent load balancing
      const sfuNode = this.selectSFUNode();
      if (!sfuNode) {
        console.error('❌ No SFU nodes available');
        socket.emit('error', { message: 'No servers available. Please try again later.' });
        socket.disconnect();
        return;
      }
      
      // Track the connection
      this.trackConnection(socket.id, sfuNode.id);
      socket.sfuNode = sfuNode;
      
      console.log(`🎯 Assigned client ${socket.id} to SFU node ${sfuNode.id}`);
      
      // Proxy all events to the assigned SFU node
      this.proxyToSFUNode(socket, sfuNode);
      
      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        this.untrackConnection(socket.id);
      });
    });
  }

  async discoverSFUNodes() {
    try {
      console.log('🔍 Discovering SFU nodes...');
      const response = await makeHttpRequest('http://localhost:4000/api/nodes', {
        method: 'GET'
      });
      
      const nodes = JSON.parse(response);
      this.sfuNodes.clear();
      
      nodes.forEach(node => {
        this.sfuNodes.set(node.id, node);
        console.log(`📡 Discovered SFU node: ${node.id} at ${node.host}:${node.port}`);
      });
      
      console.log(`✅ Discovered ${this.sfuNodes.size} SFU nodes`);
    } catch (error) {
      console.error('❌ Failed to discover SFU nodes:', error);
    }
  }

  selectSFUNode() {
    const availableNodes = Array.from(this.sfuNodes.values()).filter(node => {
      const health = this.nodeHealth.get(node.id);
      const connections = this.loadBalancer.connectionCounts.get(node.id) || 0;
      
      return health && 
             health.status === 'healthy' && 
             connections < this.maxConnectionsPerNode &&
             health.cpu < 80 && // CPU usage below 80%
             health.memory < 80; // Memory usage below 80%
    });
    
    if (availableNodes.length === 0) {
      console.error('❌ No healthy SFU nodes available');
      return null;
    }
    
    // Weighted least connections algorithm
    let bestNode = null;
    let lowestScore = Infinity;
    
    availableNodes.forEach(node => {
      const connections = this.loadBalancer.connectionCounts.get(node.id) || 0;
      const health = this.nodeHealth.get(node.id);
      const weight = this.loadBalancer.weights.get(node.id) || 1;
      
      // Score based on: connections/weight + CPU usage + memory usage
      const score = (connections / weight) + (health.cpu / 100) + (health.memory / 100);
      
      if (score < lowestScore) {
        lowestScore = score;
        bestNode = node;
      }
    });
    
    // Update connection count
    const currentConnections = this.loadBalancer.connectionCounts.get(bestNode.id) || 0;
    this.loadBalancer.connectionCounts.set(bestNode.id, currentConnections + 1);
    
    console.log(`🎯 Selected SFU node ${bestNode.id} (${currentConnections + 1}/${this.maxConnectionsPerNode} connections)`);
    return bestNode;
  }

  proxyToSFUNode(socket, sfuNode) {
    // Create a proxy connection to the SFU node
    const io = require('socket.io-client');
    const sfuSocket = io(`http://${sfuNode.host}:${sfuNode.port}`);
    
    sfuSocket.on('connect', () => {
      console.log(`🔗 Proxy connected to SFU node ${sfuNode.id}`);
      socket.emit('connect'); // Notify client of successful connection
    });
    
    sfuSocket.on('disconnect', () => {
      console.log(`🔗 Proxy disconnected from SFU node ${sfuNode.id}`);
      socket.emit('disconnect');
    });
    
    // Forward all events from client to SFU node
    const eventsToProxy = [
      'join-room', 'leave-room', 'get-router-capabilities', 'create-transport',
      'connect-transport', 'produce', 'consume', 'get-producers', 'producer-stats',
      'consumer-stats', 'pause-producer', 'resume-producer', 'pause-consumer',
      'resume-consumer', 'ping'
    ];
    
    eventsToProxy.forEach(eventName => {
      socket.on(eventName, (data, callback) => {
        console.log(`🔄 Proxying event ${eventName} to SFU node ${sfuNode.id}`);
        sfuSocket.emit(eventName, data, callback);
      });
    });
    
    // Forward all events from SFU node to client
    const eventsFromSFU = [
      'room-joined', 'room-left', 'error', 'new-producer', 'producer-closed',
      'producers', 'pong', 'participant-joined', 'participant-left', 'message'
    ];
    
    eventsFromSFU.forEach(eventName => {
      sfuSocket.on(eventName, (data) => {
        console.log(`🔄 Forwarding event ${eventName} from SFU node ${sfuNode.id}`);
        socket.emit(eventName, data);
      });
    });
    
    // Clean up when client disconnects
    socket.on('disconnect', () => {
      sfuSocket.disconnect();
    });
  }
}

module.exports = WebServer;

// If this file is run directly, start the web server
if (require.main === module) {
  const webServer = new WebServer({
    port: process.env.PORT || 2020,
    coordinatorUrl: process.env.COORDINATOR_URL || 'http://localhost:4000'
  });

  webServer.start()
    .then(() => {
      console.log('✅ Web server started successfully');
    })
    .catch((error) => {
      console.error('❌ Failed to start web server:', error);
      process.exit(1);
    });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    try {
      await webServer.stop();
      console.log('🛑 Web server shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    try {
      await webServer.stop();
      console.log('🛑 Web server shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });
}