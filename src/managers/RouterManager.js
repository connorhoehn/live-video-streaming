/**
 * Enhanced Router Manager - Handles MediaSoup routers with cluster support
 * Integrated from sample_cluster architecture
 */

const EventEmitter = require('events');
const CoordinatorClient = require('../services/coordinator-client');

class RouterManager extends EventEmitter {
  constructor(workers = [], config = {}) {
    super();
    this.workers = workers;
    this.routers = new Map();
    this.routerWorkerMap = new Map(); // routerId -> worker mapping
    this.workerLoadMap = new Map(); // workerId -> load info
    this.remoteRouters = new Map(); // Remote routers from other nodes
    this.pipeTransports = new Map(); // Pipe transports between routers
    this.streamRoutes = new Map(); // Track producer -> consumer routes
    
    // Initialize coordinator client if config provided
    this.coordinatorClient = config.coordinatorClient || 
      new CoordinatorClient({
        nodeId: config.nodeId || process.env.NODE_ID || 'sfu1',
        coordinatorUrl: config.coordinatorUrl || process.env.COORDINATOR_URL,
        host: config.host || 'localhost',
        port: config.port || process.env.PORT || 3001
      });
    
    this.nodeId = config.nodeId || process.env.NODE_ID || 'sfu1';
    this.config = {
      mediaCodecs: config.mediaCodecs || [
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
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000
          }
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
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        }
      ],
      ...config
    };

    // Initialize worker load tracking
    this.initializeWorkerTracking();
  }

  /**
   * Initialize worker load tracking
   */
  initializeWorkerTracking() {
    for (const worker of this.workers) {
      this.workerLoadMap.set(worker.pid, {
        worker,
        routerCount: 0,
        transportCount: 0,
        producerCount: 0,
        consumerCount: 0,
        lastUpdated: new Date()
      });
    }
  }

  getRouterForProducer(producerId) {
  for (const routerInfo of this.routers.values()) {
    if (routerInfo.router.getProducers().some(p => p.id === producerId)) {
      return routerInfo.router;
    }
  }
  return null;
}

  /**
   * Add a worker to the pool
   */
  addWorker(worker) {
    this.workers.push(worker);
    this.workerLoadMap.set(worker.pid, {
      worker,
      routerCount: 0,
      transportCount: 0,
      producerCount: 0,
      consumerCount: 0,
      lastUpdated: new Date()
    });
    
    console.log(`👷 Worker added to router manager: PID ${worker.pid}`);
    this.emit('workerAdded', { worker });
  }

  /**
   * Remove a worker from the pool
   */
  removeWorker(workerPid) {
    const workerIndex = this.workers.findIndex(w => w.pid === workerPid);
    if (workerIndex === -1) {
      return false;
    }

    // Close all routers on this worker
    const routersToClose = [];
    for (const [routerId, worker] of this.routerWorkerMap.entries()) {
      if (worker.pid === workerPid) {
        routersToClose.push(routerId);
      }
    }

    for (const routerId of routersToClose) {
      this.closeRouter(routerId);
    }

    this.workers.splice(workerIndex, 1);
    this.workerLoadMap.delete(workerPid);
    
    console.log(`👷 Worker removed from router manager: PID ${workerPid}`);
    this.emit('workerRemoved', { workerPid });
    return true;
  }

  /**
   * Select the best worker for creating a new router
   */
  selectWorker() {
    if (this.workers.length === 0) {
      throw new Error('No workers available for router creation');
    }

    // Find worker with lowest load
    let selectedWorker = null;
    let lowestLoad = Infinity;

    for (const worker of this.workers) {
      const loadInfo = this.workerLoadMap.get(worker.pid);
      if (!loadInfo) continue;

      // Calculate load score (routers have more weight than individual transports)
      const loadScore = (loadInfo.routerCount * 10) + 
                       (loadInfo.transportCount * 2) + 
                       loadInfo.producerCount + 
                       loadInfo.consumerCount;

      if (loadScore < lowestLoad) {
        lowestLoad = loadScore;
        selectedWorker = worker;
      }
    }

    if (!selectedWorker) {
      selectedWorker = this.workers[0]; // Fallback to first worker
    }

    console.log(`👷 Selected worker PID ${selectedWorker.pid} (load score: ${lowestLoad})`);
    return selectedWorker;
  }

  /**
   * Create a new router
   */
  async createRouter(options = {}) {
    const worker = options.worker || this.selectWorker();
    
    try {
      const router = await worker.createRouter({
        mediaCodecs: this.config.mediaCodecs,
        ...options
      });

      this.routers.set(router.id, {
        router,
        worker,
        createdAt: new Date(),
        roomId: options.roomId,
        metadata: options.metadata || {}
      });

      this.routerWorkerMap.set(router.id, worker);

      // Update worker load
      const loadInfo = this.workerLoadMap.get(worker.pid);
      if (loadInfo) {
        loadInfo.routerCount++;
        loadInfo.lastUpdated = new Date();
      }

      console.log(`🌐 Router created: ${router.id} on worker PID ${worker.pid}`);
      this.emit('routerCreated', {
        routerId: router.id,
        workerPid: worker.pid,
        roomId: options.roomId
      });
      
      // Register router with coordinator if possible
      try {
        await this.coordinatorClient.sendStats({
          routerCreated: {
            routerId: router.id,
            nodeId: this.nodeId,
            roomId: options.roomId,
            workerPid: worker.pid,
            timestamp: Date.now()
          }
        });
      } catch (coordError) {
        console.warn(`⚠️ Could not register router with coordinator: ${coordError.message}`);
      }

      return {
        id: router.id,
        rtpCapabilities: router.rtpCapabilities,
        router
      };
    } catch (error) {
      console.error('❌ Failed to create router:', error);
      throw error;
    }
  }

  /**
   * Get router by ID
   */
  getRouter(routerId) {
    const routerInfo = this.routers.get(routerId);
    return routerInfo ? routerInfo.router : null;
  }

  /**
   * Get router info by ID
   */
  getRouterInfo(routerId) {
    return this.routers.get(routerId);
  }

  /**
   * Get router RTP capabilities
   */
  getRouterRtpCapabilities(routerId) {
    const router = this.getRouter(routerId);
    return router ? router.rtpCapabilities : null;
  }

  /**
   * Close router
   */
  async closeRouter(routerId) {
    const routerInfo = this.routers.get(routerId);
    if (!routerInfo) {
      return false;
    }

    try {
      routerInfo.router.close();
      
      // Update worker load
      const loadInfo = this.workerLoadMap.get(routerInfo.worker.pid);
      if (loadInfo) {
        loadInfo.routerCount = Math.max(0, loadInfo.routerCount - 1);
        loadInfo.lastUpdated = new Date();
      }

      this.routers.delete(routerId);
      this.routerWorkerMap.delete(routerId);

      console.log(`🗑️  Router closed: ${routerId}`);
      this.emit('routerClosed', { routerId });
      return true;
    } catch (error) {
      console.error(`❌ Failed to close router ${routerId}:`, error);
      return false;
    }
  }

  /**
   * Check if router can consume a producer
   */
  canConsume(routerId, producerId, rtpCapabilities) {
    const router = this.getRouter(routerId);
    if (!router) {
      return false;
    }

    try {
      return router.canConsume({ producerId, rtpCapabilities });
    } catch (error) {
      console.error(`❌ Failed to check if router ${routerId} can consume producer ${producerId}:`, error);
      return false;
    }
  }

  /**
   * Update worker load statistics
   */
  updateWorkerLoad(workerPid, loadUpdate) {
    const loadInfo = this.workerLoadMap.get(workerPid);
    if (!loadInfo) {
      return;
    }

    Object.assign(loadInfo, loadUpdate, { lastUpdated: new Date() });
    
    this.emit('workerLoadUpdated', { workerPid, loadInfo });
  }

  /**
   * Get worker load information
   */
  getWorkerLoad(workerPid) {
    return this.workerLoadMap.get(workerPid);
  }

  /**
   * Get all worker loads
   */
  getAllWorkerLoads() {
    const loads = {};
    for (const [workerPid, loadInfo] of this.workerLoadMap.entries()) {
      loads[workerPid] = { ...loadInfo };
    }
    return loads;
  }

  /**
   * Get router for room (create if doesn't exist)
   */
  async getOrCreateRouterForRoom(roomId, options = {}) {
    // Check if router already exists for this room
    for (const [routerId, routerInfo] of this.routers.entries()) {
      if (routerInfo.roomId === roomId) {
        return {
          id: routerId,
          rtpCapabilities: routerInfo.router.rtpCapabilities,
          router: routerInfo.router
        };
      }
    }

    // Create new router for room
    return this.createRouter({ roomId, ...options });
  }

  /**
   * Get routers by room
   */
  getRoomRouters(roomId) {
    const roomRouters = [];
    for (const [routerId, routerInfo] of this.routers.entries()) {
      if (routerInfo.roomId === roomId) {
        roomRouters.push({
          id: routerId,
          rtpCapabilities: routerInfo.router.rtpCapabilities,
          worker: routerInfo.worker,
          createdAt: routerInfo.createdAt
        });
      }
    }
    return roomRouters;
  }

  /**
   * Create pipe between routers (for cross-node communication)
   */
  async createPipeBetweenRouters(sourceRouterId, targetRouterId, options = {}) {
    const sourceRouter = this.getRouter(sourceRouterId);
    const targetRouter = this.getRouter(targetRouterId);

    if (!sourceRouter) {
      throw new Error(`Source router ${sourceRouterId} not found`);
    }

    if (!targetRouter) {
      throw new Error(`Target router ${targetRouterId} not found`);
    }

    try {
      // Create pipe transports
      const sourcePipeTransport = await sourceRouter.createPipeTransport({
        listenIp: options.listenIp || '127.0.0.1',
        enableSctp: true,
        numSctpStreams: { OS: 1024, MIS: 1024 }
      });

      const targetPipeTransport = await targetRouter.createPipeTransport({
        listenIp: options.listenIp || '127.0.0.1',
        enableSctp: true,
        numSctpStreams: { OS: 1024, MIS: 1024 }
      });

      // Connect pipe transports
      await sourcePipeTransport.connect({
        ip: targetPipeTransport.tuple.localIp,
        port: targetPipeTransport.tuple.localPort,
        srtpParameters: targetPipeTransport.srtpParameters
      });

      await targetPipeTransport.connect({
        ip: sourcePipeTransport.tuple.localIp,
        port: sourcePipeTransport.tuple.localPort,
        srtpParameters: sourcePipeTransport.srtpParameters
      });

      console.log(`🔗 Pipe created between routers ${sourceRouterId} and ${targetRouterId}`);
      
      // Store pipe transport information for tracking
      const pipeInfo = {
        sourceRouterId,
        targetRouterId,
        sourcePipeTransportId: sourcePipeTransport.id,
        targetPipeTransportId: targetPipeTransport.id,
        createdAt: new Date()
      };
      
      this.pipeTransports.set(`${sourceRouterId}_${targetRouterId}`, pipeInfo);
      
      this.emit('pipeCreated', pipeInfo);
      
      // Register pipe with coordinator if possible
      try {
        await this.coordinatorClient.sendStats({
          pipeCreated: {
            sourceRouterId,
            targetRouterId,
            nodeId: this.nodeId,
            timestamp: Date.now()
          }
        });
      } catch (coordError) {
        console.warn(`⚠️ Could not register pipe with coordinator: ${coordError.message}`);
      }

      return {
        sourcePipeTransport,
        targetPipeTransport,
        pipeInfo
      };
    } catch (error) {
      console.error(`❌ Failed to create pipe between routers ${sourceRouterId} and ${targetRouterId}:`, error);
      throw error;
    }
  }

  /**
   * Get router statistics
   */
  async getRouterStats(routerId) {
    const routerInfo = this.routers.get(routerId);
    if (!routerInfo) {
      return null;
    }

    try {
      return {
        routerId,
        workerPid: routerInfo.worker.pid,
        roomId: routerInfo.roomId,
        createdAt: routerInfo.createdAt,
        rtpCapabilities: routerInfo.router.rtpCapabilities,
        metadata: routerInfo.metadata
      };
    } catch (error) {
      console.error(`❌ Failed to get stats for router ${routerId}:`, error);
      return null;
    }
  }

  /**
   * Get global router statistics
   */
  getGlobalStats() {
    const routerStats = Array.from(this.routers.keys()).map(routerId => 
      this.getRouterStats(routerId)
    ).filter(Boolean);

    return {
      totalRouters: this.routers.size,
      totalWorkers: this.workers.length,
      routersByRoom: this.getRoutersByRoom(),
      routersByWorker: this.getRoutersByWorker(),
      workerLoads: this.getAllWorkerLoads(),
      routerStats
    };
  }

  /**
   * Helper: Get routers grouped by room
   */
  getRoutersByRoom() {
    const byRoom = {};
    for (const [routerId, routerInfo] of this.routers.entries()) {
      if (routerInfo.roomId) {
        if (!byRoom[routerInfo.roomId]) {
          byRoom[routerInfo.roomId] = [];
        }
        byRoom[routerInfo.roomId].push({
          id: routerId,
          workerPid: routerInfo.worker.pid,
          createdAt: routerInfo.createdAt
        });
      }
    }
    return byRoom;
  }

  /**
   * Helper: Get routers grouped by worker
   */
  getRoutersByWorker() {
    const byWorker = {};
    for (const [routerId, routerInfo] of this.routers.entries()) {
      const workerPid = routerInfo.worker.pid;
      if (!byWorker[workerPid]) {
        byWorker[workerPid] = [];
      }
      byWorker[workerPid].push({
        id: routerId,
        roomId: routerInfo.roomId,
        createdAt: routerInfo.createdAt
      });
    }
    return byWorker;
  }

  /**
   * Clean up all routers
   */
  async cleanup() {
    console.log(`🧹 Cleaning up ${this.routers.size} routers`);
    
    // Close all routers
    for (const [routerId, routerInfo] of this.routers.entries()) {
      try {
        routerInfo.router.close();
        this.emit('routerClosed', { routerId });
      } catch (err) {
        console.error(`Error closing router ${routerId}:`, err);
      }
    }
    
    // Clear all maps
    this.routers.clear();
    this.routerWorkerMap.clear();
    this.remoteRouters.clear();
    this.pipeTransports.clear();
    this.streamRoutes.clear();
    
    // Stop coordinator client
    if (this.coordinatorClient) {
      try {
        this.coordinatorClient.stop();
      } catch (err) {
        console.error('Error stopping coordinator client:', err);
      }
    }
    
    console.log('✅ All routers and tracking data cleaned up');
  }

  /**
   * Initialize and connect to the coordinator
   */
  async initializeCoordinator() {
    try {
      await this.coordinatorClient.register();
      
      // Set up periodic reporting of router and stream stats
      setInterval(() => this.reportRouterStats(), 10000);
      
      console.log('✅ RouterManager registered with coordinator');
      return true;
    } catch (error) {
      console.error('❌ Failed to register RouterManager with coordinator:', error.message);
      return false;
    }
  }
  
  /**
   * Report router statistics to the coordinator
   */
  async reportRouterStats() {
    try {
      const routerStats = {
        nodeId: this.nodeId,
        totalRouters: this.routers.size,
        totalWorkers: this.workers.length,
        workerLoads: Object.fromEntries(
          Array.from(this.workerLoadMap.entries()).map(([pid, info]) => [
            pid, 
            {
              routerCount: info.routerCount,
              transportCount: info.transportCount,
              producerCount: info.producerCount,
              consumerCount: info.consumerCount
            }
          ])
        ),
        streamRoutes: this.getStreamRoutesInfo(),
        timestamp: Date.now()
      };
      
      await this.coordinatorClient.sendStats({
        routerStats,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to report router stats:', error.message);
      return false;
    }
  }
  
  /**
   * Register a stream route (producer -> consumer path)
   * @param {Object} routeInfo Information about the stream route
   */
  registerStreamRoute(routeInfo) {
    const { 
      streamId, 
      producerId, 
      consumerId, 
      producerNodeId = this.nodeId, 
      consumerNodeId = this.nodeId,
      routerId,
      roomId,
      participantId,
      kind, // audio/video
      remoteRouterId = null
    } = routeInfo;
    
    const routeKey = `${producerId}_${consumerId}`;
    
    this.streamRoutes.set(routeKey, {
      streamId,
      producerId,
      consumerId,
      producerNodeId,
      consumerNodeId,
      routerId,
      remoteRouterId,
      roomId,
      participantId,
      kind,
      createdAt: new Date(),
      active: true,
      crossNode: producerNodeId !== consumerNodeId
    });
    
    console.log(`🔀 Stream route registered: ${routeKey}`);
    console.log(`  🎬 Stream: ${streamId}`);
    console.log(`  🎙️ Producer: ${producerId} (${producerNodeId})`);
    console.log(`  🎧 Consumer: ${consumerId} (${consumerNodeId})`);
    console.log(`  🏠 Room: ${roomId}`);
    
    this.emit('streamRouteCreated', { routeKey, routeInfo: this.streamRoutes.get(routeKey) });
    return routeKey;
  }
  
  /**
   * Get information about all stream routes
   */
  getStreamRoutesInfo() {
    return Array.from(this.streamRoutes.entries()).map(([routeKey, routeInfo]) => ({
      routeKey,
      ...routeInfo,
      createdAt: routeInfo.createdAt.toISOString()
    }));
  }
  
  /**
   * Get stream routes for a specific room
   */
  getRoomStreamRoutes(roomId) {
    return Array.from(this.streamRoutes.values())
      .filter(route => route.roomId === roomId)
      .map(route => ({
        ...route,
        createdAt: route.createdAt.toISOString()
      }));
  }
  
  /**
   * Get stream routes for a specific participant
   */
  getParticipantStreamRoutes(participantId) {
    return Array.from(this.streamRoutes.values())
      .filter(route => route.participantId === participantId)
      .map(route => ({
        ...route,
        createdAt: route.createdAt.toISOString()
      }));
  }

  /**
   * Fetch remote router information from the coordinator
   */
  async fetchRemoteRouters() {
    try {
      // Get all nodes from coordinator
      const nodes = await this.coordinatorClient.getAllNodes();
      
      // Skip our own node
      const remoteNodes = nodes.filter(node => node.id !== this.nodeId);
      
      for (const node of remoteNodes) {
        // We'll store basic info about remote routers for potential pipe creation
        this.remoteRouters.set(node.id, {
          nodeId: node.id,
          host: node.host,
          port: node.port,
          routers: node.stats?.routerStats?.routersByRoom || {},
          lastUpdated: new Date()
        });
      }
      
      console.log(`📡 Fetched remote router info for ${remoteNodes.length} nodes`);
      return true;
    } catch (error) {
      console.error('❌ Failed to fetch remote routers:', error.message);
      return false;
    }
  }

  /**
   * Create visualization data for all stream routes in the system
   * This can be used to generate a network graph of all streams
   */
  createStreamVisualization() {
    // Create nodes for routers
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    
    // Add routers as nodes
    for (const [routerId, routerInfo] of this.routers.entries()) {
      const nodeId = `router_${routerId}`;
      nodes.push({
        id: nodeId,
        label: `Router ${routerId.substr(0, 8)}`,
        type: 'router',
        roomId: routerInfo.roomId,
        workerPid: routerInfo.worker?.pid,
        createdAt: routerInfo.createdAt
      });
      nodeMap.set(routerId, nodeId);
    }
    
    // Add remote routers
    for (const [nodeId, nodeInfo] of this.remoteRouters.entries()) {
      if (nodeInfo.routers) {
        for (const roomId in nodeInfo.routers) {
          for (const router of nodeInfo.routers[roomId]) {
            const routerId = router.id;
            const nodeId = `router_${routerId}_remote`;
            nodes.push({
              id: nodeId,
              label: `Remote Router ${routerId.substr(0, 8)}`,
              type: 'remote_router',
              roomId,
              nodeId: nodeInfo.nodeId,
              createdAt: router.createdAt
            });
            nodeMap.set(routerId, nodeId);
          }
        }
      }
    }
    
    // Add pipe connections as edges
    for (const [pipeId, pipeInfo] of this.pipeTransports.entries()) {
      const sourceNodeId = nodeMap.get(pipeInfo.sourceRouterId);
      const targetNodeId = nodeMap.get(pipeInfo.targetRouterId);
      
      if (sourceNodeId && targetNodeId) {
        edges.push({
          id: `pipe_${pipeId}`,
          source: sourceNodeId,
          target: targetNodeId,
          type: 'pipe',
          label: 'Pipe'
        });
      }
    }
    
    // Add stream routes as edges
    for (const [routeId, routeInfo] of this.streamRoutes.entries()) {
      const producerId = `producer_${routeInfo.producerId}`;
      const consumerId = `consumer_${routeInfo.consumerId}`;
      
      // Add producer node if doesn't exist
      if (!nodeMap.has(producerId)) {
        nodes.push({
          id: producerId,
          label: `Producer ${routeInfo.producerId.substr(0, 8)}`,
          type: 'producer',
          kind: routeInfo.kind,
          nodeId: routeInfo.producerNodeId,
          roomId: routeInfo.roomId
        });
        nodeMap.set(producerId, producerId);
      }
      
      // Add consumer node if doesn't exist
      if (!nodeMap.has(consumerId)) {
        nodes.push({
          id: consumerId,
          label: `Consumer ${routeInfo.consumerId.substr(0, 8)}`,
          type: 'consumer',
          kind: routeInfo.kind,
          nodeId: routeInfo.consumerNodeId,
          roomId: routeInfo.roomId
        });
        nodeMap.set(consumerId, consumerId);
      }
      
      // Add edge from producer to consumer
      edges.push({
        id: `stream_${routeId}`,
        source: producerId,
        target: consumerId,
        type: 'stream',
        label: routeInfo.kind,
        crossNode: routeInfo.crossNode,
        streamId: routeInfo.streamId
      });
      
      // Add edge from router to producer
      if (nodeMap.has(routeInfo.routerId)) {
        edges.push({
          id: `router_producer_${routeInfo.producerId}`,
          source: nodeMap.get(routeInfo.routerId),
          target: producerId,
          type: 'router_to_producer'
        });
      }
      
      // Add edge from router to consumer
      if (nodeMap.has(routeInfo.routerId)) {
        edges.push({
          id: `router_consumer_${routeInfo.consumerId}`,
          source: nodeMap.get(routeInfo.routerId),
          target: consumerId,
          type: 'router_to_consumer'
        });
      }
    }
    
    return {
      nodes,
      edges,
      timestamp: new Date().toISOString(),
      nodeId: this.nodeId
    };
  }
  
  /**
   * Set up API endpoints for stream routing visualization
   * @param {Express} app - Express app instance
   */
  setupVisualizationEndpoints(app) {
    if (!app) {
      return;
    }
    
    // Get visualization data
    app.get('/routers/visualization', (req, res) => {
      res.json(this.createStreamVisualization());
    });
    
    // Get router info
    app.get('/routers', (req, res) => {
      const routerInfo = Array.from(this.routers.entries()).map(([routerId, info]) => ({
        id: routerId,
        roomId: info.roomId,
        workerPid: info.worker?.pid,
        createdAt: info.createdAt
      }));
      
      res.json(routerInfo);
    });
    
    // Get stream routes
    app.get('/routers/streams', (req, res) => {
      res.json(this.getStreamRoutesInfo());
    });
    
    // Get specific room stream routes
    app.get('/routers/rooms/:roomId/streams', (req, res) => {
      const { roomId } = req.params;
      res.json(this.getRoomStreamRoutes(roomId));
    });
    
    // Get pipe transports
    app.get('/routers/pipes', (req, res) => {
      const pipes = Array.from(this.pipeTransports.entries()).map(([id, info]) => ({
        id,
        ...info,
        createdAt: info.createdAt.toISOString()
      }));
      
      res.json(pipes);
    });
    
    console.log('🔍 Router visualization endpoints registered');
  }
  
  /**
   * Add a router to the manager
   */
  async addRouter(router, options = {}) {
    const routerId = router.id;
    const routerInfo = {
      router,
      workerId: options.workerId || null,
      isDefault: options.isDefault || false,
      load: 0,
      createdAt: new Date()
    };
    
    this.routers.set(routerId, routerInfo);
    
    if (options.workerId) {
      this.routerWorkerMap.set(routerId, options.workerId);
    }
    
    console.log(`🔧 Router ${routerId} added to RouterManager (default: ${options.isDefault})`);
    return routerId;
  }
  
  /**
   * Get default router (first router or create one)
   */
  getDefaultRouter() {
    // Return the first router marked as default
    for (const [routerId, routerInfo] of this.routers.entries()) {
      if (routerInfo.isDefault) {
        return routerInfo.router;
      }
    }
    
    // Return the first router if no default is marked
    for (const [routerId, routerInfo] of this.routers.entries()) {
      return routerInfo.router;
    }
    
    // If no routers exist, we can't return a default one without creating it
    return null;
  }
}

module.exports = RouterManager;
