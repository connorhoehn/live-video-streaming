class ClusterCoordinator {
  constructor() {
    this.clusterNodes = new Map();
    this.roomAssignments = new Map();
    this.nodeStats = new Map();
    this.routerRegistry = new Map();
    this.streamRoutes = new Map();
    this.pipeConnections = new Map();
  }

  // Load balancing helper
  selectLeastLoadedNode() {
    let selectedNode = null;
    let minLoad = Infinity;
    
    for (const [nodeId, node] of this.clusterNodes) {
      const load = this.nodeStats.get(nodeId)?.load || 0;
      if (load < minLoad && node.status === 'active') {
        minLoad = load;
        selectedNode = { id: nodeId, ...node };
      }
    }
    
    return selectedNode;
  }

  registerNode(nodeId, nodeInfo) {
    this.clusterNodes.set(nodeId, { 
      ...nodeInfo,
      status: 'active',
      registeredAt: new Date()
    });
    this.nodeStats.set(nodeId, { load: 0, rooms: 0, participants: 0 });
    console.log(`Node registered: ${nodeId} at ${nodeInfo.host}:${nodeInfo.port}`);
    return { success: true, nodeId };
  }

  updateNodeStats(nodeId, stats) {
    // Update basic stats
    this.nodeStats.set(nodeId, { 
      ...stats,
      lastUpdated: new Date() 
    });
    
    // Track additional stats if provided
    if (stats.routerCreated) {
      const { routerId, workerPid, roomId, timestamp } = stats.routerCreated;
      this.routerRegistry.set(routerId, {
        routerId,
        nodeId,
        workerPid,
        roomId,
        createdAt: new Date(timestamp || Date.now())
      });
    }
    
    if (stats.pipeCreated) {
      const { sourceRouterId, targetRouterId, timestamp } = stats.pipeCreated;
      this.pipeConnections.set(`${sourceRouterId}_${targetRouterId}`, {
        sourceRouterId,
        targetRouterId,
        nodeId,
        createdAt: new Date(timestamp || Date.now())
      });
    }
    
    // Track detailed router stats if provided
    if (stats.routerStats) {
      if (stats.routerStats.workerLoads) {
        Object.entries(stats.routerStats.workerLoads).forEach(([pid, loadInfo]) => {
          this.nodeStats.set(`${nodeId}_worker_${pid}`, {
            ...loadInfo,
            nodeId,
            pid,
            lastUpdated: new Date()
          });
        });
      }
      
      if (stats.routerStats.streamRoutes) {
        stats.routerStats.streamRoutes.forEach(route => {
          this.streamRoutes.set(`${route.producerId}_${route.consumerId}`, {
            ...route,
            nodeId,
            lastUpdated: new Date()
          });
        });
      }
    }
    
    return { success: true };
  }

  getNodes() {
    return Array.from(this.clusterNodes.entries()).map(([id, node]) => ({
      id,
      ...node,
      stats: this.nodeStats.get(id) || {}
    }));
  }

  assignRoom(roomId) {
    const selectedNode = this.selectLeastLoadedNode();
    
    if (!selectedNode) {
      throw new Error('No available nodes');
    }
    
    this.roomAssignments.set(roomId, selectedNode.id);
    const stats = this.nodeStats.get(selectedNode.id);
    this.nodeStats.set(selectedNode.id, { ...stats, rooms: (stats.rooms || 0) + 1 });
    
    console.log(`Room ${roomId} assigned to node ${selectedNode.id}`);
    return { 
      nodeId: selectedNode.id, 
      host: selectedNode.host, 
      port: selectedNode.port 
    };
  }

  getRoomNode(roomId) {
    const nodeId = this.roomAssignments.get(roomId);
    
    if (!nodeId) {
      return null;
    }
    
    const node = this.clusterNodes.get(nodeId);
    return { nodeId, ...node };
  }

  deleteRoom(roomId) {
    const nodeId = this.roomAssignments.get(roomId);
    
    if (nodeId) {
      this.roomAssignments.delete(roomId);
      const stats = this.nodeStats.get(nodeId);
      this.nodeStats.set(nodeId, { ...stats, rooms: Math.max(0, (stats.rooms || 1) - 1) });
    }
    
    return { success: true };
  }

  getHealth() {
    return { 
      status: 'healthy', 
      nodes: this.clusterNodes.size, 
      rooms: this.roomAssignments.size 
    };
  }

  // Visualization data generation
  getVisualizationData() {
    // Create nodes (SFU nodes)
    const nodes = Array.from(this.clusterNodes.entries()).map(([id, node]) => ({
      id: `node_${id}`,
      label: id,
      type: 'node',
      host: node.host,
      port: node.port,
      status: node.status,
      registeredAt: node.registeredAt
    }));
    
    // Add routers as nodes
    for (const [routerId, router] of this.routerRegistry.entries()) {
      nodes.push({
        id: `router_${routerId}`,
        label: `Router ${routerId.substr(0, 8)}`,
        type: 'router',
        nodeId: router.nodeId,
        roomId: router.roomId,
        workerPid: router.workerPid
      });
    }
    
    // Create edges
    const edges = [];
    
    // Node -> Router edges
    for (const [routerId, router] of this.routerRegistry.entries()) {
      edges.push({
        id: `node_router_${routerId}`,
        source: `node_${router.nodeId}`,
        target: `router_${routerId}`,
        type: 'node_router'
      });
    }
    
    // Pipe connections
    for (const [pipeId, pipe] of this.pipeConnections.entries()) {
      edges.push({
        id: `pipe_${pipeId}`,
        source: `router_${pipe.sourceRouterId}`,
        target: `router_${pipe.targetRouterId}`,
        type: 'pipe'
      });
    }
    
    // Stream routes
    for (const [routeId, route] of this.streamRoutes.entries()) {
      // Add producer and consumer nodes if they don't exist
      const producerId = `producer_${route.producerId}`;
      const consumerId = `consumer_${route.consumerId}`;
      
      if (!nodes.some(n => n.id === producerId)) {
        nodes.push({
          id: producerId,
          label: `Producer ${route.producerId.substr(0, 8)}`,
          type: 'producer',
          kind: route.kind,
          nodeId: route.producerNodeId,
          roomId: route.roomId
        });
      }
      
      if (!nodes.some(n => n.id === consumerId)) {
        nodes.push({
          id: consumerId,
          label: `Consumer ${route.consumerId.substr(0, 8)}`,
          type: 'consumer',
          kind: route.kind,
          nodeId: route.consumerNodeId,
          roomId: route.roomId
        });
      }
      
      // Producer -> Consumer edge
      edges.push({
        id: `stream_${routeId}`,
        source: producerId,
        target: consumerId,
        type: 'stream',
        streamId: route.streamId,
        kind: route.kind
      });
      
      // Router -> Producer edge
      if (route.routerId) {
        edges.push({
          id: `router_producer_${route.producerId}`,
          source: `router_${route.routerId}`,
          target: producerId,
          type: 'router_producer'
        });
      }
      
      // Router -> Consumer edge  
      if (route.routerId) {
        edges.push({
          id: `router_consumer_${route.consumerId}`,
          source: `router_${route.routerId}`,
          target: consumerId,
          type: 'router_consumer'
        });
      }
    }
    
    return {
      nodes,
      edges,
      timestamp: new Date().toISOString()
    };
  }

  // Get all routers
  getAllRouters() {
    return Array.from(this.routerRegistry.entries()).map(([id, router]) => ({
      id,
      nodeId: router.nodeId,
      roomId: router.roomId,
      workerPid: router.workerPid,
      createdAt: router.createdAt
    }));
  }

  // Get all stream routes
  getAllStreamRoutes() {
    return Array.from(this.streamRoutes.entries()).map(([id, route]) => ({
      id,
      ...route
    }));
  }

  // Get all pipe connections
  getAllPipeConnections() {
    return Array.from(this.pipeConnections.entries()).map(([id, pipe]) => ({
      id,
      ...pipe
    }));
  }

  // Health check
  getHealthStatus() {
    return { 
      status: 'healthy', 
      nodes: this.clusterNodes.size, 
      rooms: this.roomAssignments.size 
    };
  }

  // Clean up disconnected nodes
  cleanupNode(nodeId) {
    const node = this.clusterNodes.get(nodeId);
    if (node) {
      this.clusterNodes.delete(nodeId);
      this.nodeStats.delete(nodeId);
      
      // Remove associated routers
      for (const [routerId, router] of this.routerRegistry.entries()) {
        if (router.nodeId === nodeId) {
          this.routerRegistry.delete(routerId);
        }
      }
      
      // Remove associated pipes
      for (const [pipeId, pipe] of this.pipeConnections.entries()) {
        if (pipe.nodeId === nodeId) {
          this.pipeConnections.delete(pipeId);
        }
      }
      
      // Remove associated stream routes
      for (const [routeId, route] of this.streamRoutes.entries()) {
        if (route.nodeId === nodeId) {
          this.streamRoutes.delete(routeId);
        }
      }
      
      console.log(`🧹 Cleaned up node ${nodeId} and associated resources`);
      return node;
    }
    return null;
  }
}

module.exports = ClusterCoordinator;
