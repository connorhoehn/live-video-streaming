const { makeHttpRequest } = require('../utils/http');

class MeshCoordinator {
  constructor(nodeId, coordinatorUrl, signalingUrl) {
    this.nodeId = nodeId;
    this.coordinatorUrl = coordinatorUrl;
    this.signalingUrl = signalingUrl;
    this.registeredNodes = new Map();
    this.heartbeatInterval = null;
    this.statsInterval = null;
  }

  async registerWithCoordinator(nodeInfo) {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          nodeId: this.nodeId,
          host: nodeInfo.host || 'localhost',
          port: nodeInfo.port,
          capacity: nodeInfo.capacity || 100
        }
      });
      
      const result = JSON.parse(response);
      console.log(`✅ Registered with coordinator: ${result.nodeId}`);
      return result;
    } catch (error) {
      console.error('❌ Failed to register with coordinator:', error.message);
      throw error;
    }
  }

  async registerWithSignaling(nodeInfo) {
    try {
      // Since we don't have a separate signaling server, we'll register with coordinator instead
      await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          nodeId: this.nodeId,
          host: 'localhost',
          port: nodeInfo.port,
          capabilities: nodeInfo.capabilities
        }
      });
      
      console.log(`✅ Registered with signaling server as ${this.nodeId}`);
    } catch (error) {
      console.error(`❌ Failed to register with signaling server:`, error.message);
    }
  }

  startStatsReporting(getStatsCallback) {
    this.statsInterval = setInterval(async () => {
      try {
        const stats = getStatsCallback();
        await this.sendStatsToCoordinator(stats);
      } catch (error) {
        console.error('Failed to send stats to coordinator:', error.message);
      }
    }, 5000);
  }

  startHeartbeat(getHeartbeatDataCallback) {
    this.heartbeatInterval = setInterval(async () => {
      try {
        const heartbeatData = getHeartbeatDataCallback();
        await this.sendHeartbeatToSignaling(heartbeatData);
      } catch (error) {
        console.error(`❌ Heartbeat failed:`, error.message);
      }
    }, 10000);
  }

  async sendStatsToCoordinator(stats) {
    await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${this.nodeId}/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stats
    });
  }

  async sendHeartbeatToSignaling(heartbeatData) {
    const response = await makeHttpRequest(`${this.signalingUrl}/api/heartbeat/${this.nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: heartbeatData
    });
    
    console.log(`💓 Heartbeat sent to signaling server: ${heartbeatData.rooms} rooms, ${heartbeatData.participants} participants`);
  }

  // Stream route management
  async reportStreamRoute(streamRoute) {
    try {
      await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${this.nodeId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          streamRoutes: [streamRoute]
        }
      });
      
      console.log(`📊 Stream route reported: ${streamRoute.streamId}`);
    } catch (error) {
      console.error('❌ Failed to report stream route:', error.message);
    }
  }

  // Pipe connection management
  async reportPipeConnection(pipeInfo) {
    try {
      await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${this.nodeId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          pipeCreated: pipeInfo
        }
      });
      
      console.log(`🔄 Pipe connection reported: ${pipeInfo.sourceRouterId} -> ${pipeInfo.targetRouterId}`);
    } catch (error) {
      console.error('❌ Failed to report pipe connection:', error.message);
    }
  }

  // Router creation reporting
  async reportRouterCreation(routerInfo) {
    try {
      await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${this.nodeId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          routerCreated: routerInfo
        }
      });
      
      console.log(`🔄 Router creation reported: ${routerInfo.routerId}`);
    } catch (error) {
      console.error('❌ Failed to report router creation:', error.message);
    }
  }

  // Node discovery
  async discoverNodes() {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/nodes`);
      const nodes = JSON.parse(response);
      for (const node of nodes) {
        if (node.id !== this.nodeId) {
          this.registeredNodes.set(node.id, node);
        }
      }
      console.log(`🔍 Discovered ${nodes.length} nodes`);
      return nodes;
    } catch (error) {
      console.error('❌ Failed to discover nodes:', error.message);
    }
    return [];
  }

  // Room assignment
  async assignRoom(roomId) {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/rooms/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { roomId }
      });
      
      const assignment = JSON.parse(response);
      console.log(`🏠 Room ${roomId} assigned to node ${assignment.nodeId}`);
      return assignment;
    } catch (error) {
      console.error('❌ Failed to assign room:', error.message);
    }
    return null;
  }

  // Get room node assignment
  async getRoomNode(roomId) {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/rooms/${roomId}/node`);
      const nodeInfo = JSON.parse(response);
      return nodeInfo;
    } catch (error) {
      console.error('❌ Failed to get room node:', error.message);
    }
    return null;
  }

  async synchronizeMeshData() {
    try {
      // Get mesh data from all nodes
      const nodes = await this.discoverNodes();
      const meshData = new Map();
      
      for (const node of nodes) {
        if (node.id === this.nodeId) continue;
        
        try {
          const response = await makeHttpRequest(`http://${node.host}:${node.port}/api/mesh/data`);
          const nodeData = JSON.parse(response);
          meshData.set(node.id, nodeData);
        } catch (error) {
          console.warn(`Failed to sync with node ${node.id}:`, error.message);
        }
      }
      
      console.log(`🌐 [MESH SYNC] Synchronized with ${meshData.size} nodes`);
      return meshData;
    } catch (error) {
      console.error('Failed to synchronize mesh data:', error.message);
      return new Map();
    }
  }

  async updateStats(stats) {
    try {
      await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${this.nodeId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          ...stats,
          timestamp: new Date().toISOString()
        }
      });
      
      // Stats updated successfully, no need to log every time
      return true;
    } catch (error) {
      console.error('❌ Failed to update stats:', error.message);
      return false;
    }
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
  }
}

module.exports = MeshCoordinator;
