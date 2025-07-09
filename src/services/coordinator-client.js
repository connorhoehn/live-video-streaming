/**
 * Coordinator Client
 *      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.nodeId,
          host: this.host,
          port: this.port,
          capacity: this.capacity
        })
      });
      
      const result = JSON.parse(response);
      console.log(`✅ Registered with coordinator: ${result.nodeId}`);ation with the cluster coordinator
 */

const { makeHttpRequest } = require('./http-utils');

class CoordinatorClient {
  constructor(options = {}) {
    this.coordinatorUrl = options.coordinatorUrl || process.env.COORDINATOR_URL || 'http://localhost:4000';
    this.nodeId = options.nodeId || process.env.NODE_ID || 'sfu1';
    this.port = options.port || process.env.PORT || 3001;
    this.host = options.host || 'localhost';
    this.capacity = options.capacity || 100;
    this.retryInterval = options.retryInterval || 5000;
    this.heartbeatInterval = options.heartbeatInterval || 10000;
    
    this.isRegistered = false;
    this.lastError = null;
    this.heartbeatTimer = null;
    this.retryTimer = null;
  }
  
  /**
   * Register with the coordinator
   */
  async register() {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.nodeId,
          host: this.host,
          port: this.port,
          capacity: this.capacity
        })
      });
      
      const result = JSON.parse(response);
      console.log(`✅ Registered with coordinator: ${result.nodeId}`);
      
      this.isRegistered = true;
      this.startHeartbeat();
      return true;
    } catch (error) {
      this.lastError = error;
      console.error('❌ Failed to register with coordinator:', error.message);
      this.scheduleRetry();
      return false;
    }
  }
  
  /**
   * Start sending heartbeats to coordinator
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    this.heartbeatTimer = setInterval(() => this.sendStats(), this.heartbeatInterval);
  }
  
  /**
   * Send stats to coordinator
   */
  async sendStats(stats = {}) {
    if (!this.isRegistered) {
      return false;
    }
    
    try {
      await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${this.nodeId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stats,
          lastUpdated: Date.now()
        })
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to send stats to coordinator:', error.message);
      this.isRegistered = false;
      this.scheduleRetry();
      return false;
    }
  }
  
  /**
   * Schedule retry after failure
   */
  scheduleRetry() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    
    this.retryTimer = setTimeout(() => this.register(), this.retryInterval);
  }
  
  /**
   * Get node info from coordinator
   */
  async getNodeInfo(nodeId) {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/nodes/${nodeId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      return JSON.parse(response);
    } catch (error) {
      console.error(`❌ Failed to get info for node ${nodeId}:`, error.message);
      throw error;
    }
  }
  
  /**
   * Get all nodes in the cluster
   */
  async getAllNodes() {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/nodes`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      return JSON.parse(response);
    } catch (error) {
      console.error('❌ Failed to get all nodes:', error.message);
      throw error;
    }
  }
  
  /**
   * Find the best node for a new room
   */
  async findBestNodeForRoom(roomOptions = {}) {
    try {
      const response = await makeHttpRequest(`${this.coordinatorUrl}/api/rooms/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roomOptions)
      });
      
      return JSON.parse(response);
    } catch (error) {
      console.error('❌ Failed to find best node for room:', error.message);
      throw error;
    }
  }
  
  /**
   * Stop all timers
   */
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

module.exports = CoordinatorClient;
