class MetricsManager {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.metrics = {
      nodeStats: {
        load: 0,
        rooms: 0,
        participants: 0,
        uptime: 0,
        lastUpdated: Date.now()
      },
      transportStats: {
        webRtcTransports: 0,
        pipeTransports: 0,
        producers: 0,
        consumers: 0
      },
      routerStats: {
        workers: 0,
        routers: 0,
        workerLoad: []
      },
      meshData: {
        nodeInfo: {
          id: nodeId,
          startTime: new Date(),
          capabilities: null
        },
        connections: new Map(),
        crossNodeStreams: new Map(),
        nodeMetrics: {
          totalConnections: 0,
          activeStreams: 0,
          throughputBytesIn: 0,
          throughputBytesOut: 0,
          lastUpdated: new Date()
        },
        discoveredNodes: new Map()
      }
    };
  }

  setCapabilities(capabilities) {
    this.metrics.meshData.nodeInfo.capabilities = capabilities;
  }

  updateNodeStats(stats) {
    this.metrics.nodeStats = {
      ...this.metrics.nodeStats,
      ...stats,
      lastUpdated: Date.now()
    };
  }

  updateTransportStats(stats) {
    this.metrics.transportStats = {
      ...this.metrics.transportStats,
      ...stats
    };
  }

  updateRouterStats(stats) {
    this.metrics.routerStats = {
      ...this.metrics.routerStats,
      ...stats
    };
  }

  updateMeshMetrics(peers, streams, transports, producers, consumers) {
    this.metrics.meshData.nodeMetrics = {
      totalConnections: peers.size,
      activeStreams: streams.size,
      activeProducers: producers.size,
      activeConsumers: consumers.size,
      transports: transports.size,
      lastUpdated: new Date(),
      uptime: Math.floor((Date.now() - this.metrics.meshData.nodeInfo.startTime.getTime()) / 1000)
    };
  }

  trackPeerConnection(socketId, clientIp, action = 'connect') {
    const connectionInfo = {
      socketId,
      clientIp,
      action,
      timestamp: new Date(),
      nodeId: this.nodeId,
      transports: [],
      producers: [],
      consumers: [],
      streams: []
    };

    if (action === 'connect') {
      this.metrics.meshData.connections.set(socketId, connectionInfo);
    } else if (action === 'disconnect') {
      this.metrics.meshData.connections.delete(socketId);
    }
  }

  trackStreamActivity(streamId, action, details = {}) {
    const activity = {
      streamId,
      action: action, // 'create', 'produce', 'consume', 'close'
      nodeId: this.nodeId,
      timestamp: new Date(),
      details
    };

    console.log(`🌐 [MESH ACTIVITY] ${action.toUpperCase()} on ${this.nodeId}:`, activity);

    // Update cross-node stream tracking if needed
    if (action === 'create' || action === 'produce') {
      if (!this.metrics.meshData.crossNodeStreams.has(streamId)) {
        this.metrics.meshData.crossNodeStreams.set(streamId, {
          id: streamId,
          originNode: this.nodeId,
          producerNodes: new Set([this.nodeId]),
          consumerNodes: new Set(),
          createdAt: new Date(),
          lastActivity: new Date()
        });
      }
    }
  }

  calculateLoad(transports, producers, consumers, participants) {
    return Math.min(100, 
      (transports * 2) + 
      (producers * 5) +
      (consumers * 1) +
      (participants * 2)
    );
  }

  getStats() {
    const currentLoad = this.calculateLoad(
      this.metrics.transportStats.webRtcTransports,
      this.metrics.transportStats.producers,
      this.metrics.transportStats.consumers,
      this.metrics.nodeStats.participants
    );

    return {
      nodeId: this.nodeId,
      uptime: Math.floor((Date.now() - this.metrics.meshData.nodeInfo.startTime.getTime()) / 1000),
      rooms: this.metrics.nodeStats,
      transports: this.metrics.transportStats,
      routers: this.metrics.routerStats,
      load: currentLoad,
      lastUpdated: new Date()
    };
  }

  getMeshData() {
    return this.metrics.meshData;
  }

  getNodeStats() {
    return this.metrics.nodeStats;
  }

  // SFU node tracking (from signaling server)
  addSfuNode(nodeId, nodeInfo) {
    this.metrics.meshData.discoveredNodes.set(nodeId, {
      ...nodeInfo,
      lastHeartbeat: Date.now(),
      connections: 0,
      status: 'active'
    });
    console.log(`✅ [METRICS] SFU Node registered: ${nodeId} on port ${nodeInfo.port}`);
  }

  removeSfuNode(nodeId) {
    const node = this.metrics.meshData.discoveredNodes.get(nodeId);
    if (node) {
      this.metrics.meshData.discoveredNodes.delete(nodeId);
      console.log(`❌ [METRICS] SFU Node removed: ${nodeId}`);
      return node;
    }
    return null;
  }

  getSfuNode(nodeId) {
    return this.metrics.meshData.discoveredNodes.get(nodeId);
  }

  getAllSfuNodes() {
    return Array.from(this.metrics.meshData.discoveredNodes.entries());
  }

  // Select best SFU node for load balancing
  selectBestSfuNode(excludeNodes = []) {
    let bestNode = null;
    let minLoad = Infinity;
    
    for (const [nodeId, node] of this.metrics.meshData.discoveredNodes.entries()) {
      if (excludeNodes.includes(nodeId) || node.status !== 'active') {
        continue;
      }
      
      const load = node.connections || 0;
      if (load < minLoad) {
        minLoad = load;
        bestNode = { nodeId, ...node };
      }
    }
    
    return bestNode;
  }

  // Update SFU node connection count
  updateSfuNodeConnections(nodeId, connectionCount) {
    const node = this.metrics.meshData.discoveredNodes.get(nodeId);
    if (node) {
      node.connections = connectionCount;
      node.lastHeartbeat = Date.now();
    }
  }

  // Enhanced router and worker tracking
  addRouter(routerId, routerInfo) {
    this.metrics.routerStats.routers++;
    console.log(`🔄 [METRICS] Router added: ${routerId}`);
  }

  removeRouter(routerId) {
    this.metrics.routerStats.routers = Math.max(0, this.metrics.routerStats.routers - 1);
    console.log(`🔄 [METRICS] Router removed: ${routerId}`);
  }

  addWorker(workerInfo) {
    this.metrics.routerStats.workers++;
    this.metrics.routerStats.workerLoad.push({
      pid: workerInfo.pid,
      load: 0,
      timestamp: Date.now()
    });
    console.log(`👷 [METRICS] Worker added: ${workerInfo.pid}`);
  }

  removeWorker(workerPid) {
    this.metrics.routerStats.workers = Math.max(0, this.metrics.routerStats.workers - 1);
    this.metrics.routerStats.workerLoad = this.metrics.routerStats.workerLoad.filter(w => w.pid !== workerPid);
    console.log(`👷 [METRICS] Worker removed: ${workerPid}`);
  }

  // Transport tracking
  addTransport(transportType) {
    if (transportType === 'webrtc') {
      this.metrics.transportStats.webRtcTransports++;
    } else if (transportType === 'pipe') {
      this.metrics.transportStats.pipeTransports++;
    }
  }

  removeTransport(transportType) {
    if (transportType === 'webrtc') {
      this.metrics.transportStats.webRtcTransports = Math.max(0, this.metrics.transportStats.webRtcTransports - 1);
    } else if (transportType === 'pipe') {
      this.metrics.transportStats.pipeTransports = Math.max(0, this.metrics.transportStats.pipeTransports - 1);
    }
  }

  // Producer/Consumer tracking
  addProducer() {
    this.metrics.transportStats.producers++;
  }

  removeProducer() {
    this.metrics.transportStats.producers = Math.max(0, this.metrics.transportStats.producers - 1);
  }

  addConsumer() {
    this.metrics.transportStats.consumers++;
  }

  removeConsumer() {
    this.metrics.transportStats.consumers = Math.max(0, this.metrics.transportStats.consumers - 1);
  }

  // Get all metrics
  getMetrics() {
    // Update uptime
    this.metrics.nodeStats.uptime = Date.now() - this.metrics.meshData.nodeInfo.startTime.getTime();
    this.metrics.nodeStats.lastUpdated = Date.now();
    
    return this.metrics;
  }
}

module.exports = MetricsManager;
