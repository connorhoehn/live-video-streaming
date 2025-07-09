/**
 * Redis-based Mesh State Manager
 * Coordinates pipe transport connections and stream routing across SFU nodes
 */

const { createClient } = require('redis');

class RedisMeshState {
  constructor(options = {}) {
    this.nodeId = options.nodeId;
    this.redisUrl = options.redisUrl || 'redis://localhost:6377';
    this.client = null;
    this.connected = false;
  }

  async connect() {
    try {
      this.client = createClient({
        url: this.redisUrl,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
        }
      });

      this.client.on('error', (err) => {
        console.error('❌ [REDIS] Connection error:', err);
      });

      this.client.on('connect', () => {
        console.log('🔗 [REDIS] Connected to Redis');
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 [REDIS] Reconnecting to Redis...');
      });

      await this.client.connect();
      this.connected = true;
      console.log(`✅ [REDIS] Mesh state manager connected for node ${this.nodeId}`);
    } catch (error) {
      console.error('❌ [REDIS] Failed to connect:', error);
      this.connected = false;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.connected = false;
      console.log('🔌 [REDIS] Disconnected from Redis');
    }
  }

  // Pipe Transport Management
  async storePipeTransport(sourceNodeId, targetNodeId, transportData) {
    if (!this.connected) return false;
    
    try {
      const key = `pipe:${sourceNodeId}:${targetNodeId}`;
      await this.client.hSet(key, {
        transportId: transportData.id,
        ip: transportData.ip,
        port: transportData.port.toString(),
        srtpParameters: JSON.stringify(transportData.srtpParameters || {}),
        createdAt: new Date().toISOString(),
        sourceNode: sourceNodeId,
        targetNode: targetNodeId
      });
      
      console.log(`📝 [REDIS] Stored pipe transport: ${sourceNodeId} -> ${targetNodeId} (${transportData.id})`);
      return true;
    } catch (error) {
      console.error('❌ [REDIS] Failed to store pipe transport:', error);
      return false;
    }
  }

  async getPipeTransport(sourceNodeId, targetNodeId) {
    if (!this.connected) return null;
    
    try {
      const key = `pipe:${sourceNodeId}:${targetNodeId}`;
      const data = await this.client.hGetAll(key);
      
      if (!data || !data.transportId) {
        return null;
      }

      return {
        id: data.transportId,
        ip: data.ip,
        port: parseInt(data.port),
        srtpParameters: JSON.parse(data.srtpParameters || '{}'),
        createdAt: data.createdAt,
        sourceNode: data.sourceNode,
        targetNode: data.targetNode
      };
    } catch (error) {
      console.error('❌ [REDIS] Failed to get pipe transport:', error);
      return null;
    }
  }

  async getAllPipeTransports(nodeId = null) {
    if (!this.connected) return [];
    
    try {
      const pattern = nodeId ? `pipe:${nodeId}:*` : 'pipe:*';
      const keys = await this.client.keys(pattern);
      const transports = [];
      
      for (const key of keys) {
        const data = await this.client.hGetAll(key);
        if (data && data.transportId) {
          transports.push({
            id: data.transportId,
            ip: data.ip,
            port: parseInt(data.port),
            srtpParameters: JSON.parse(data.srtpParameters || '{}'),
            createdAt: data.createdAt,
            sourceNode: data.sourceNode,
            targetNode: data.targetNode
          });
        }
      }
      
      return transports;
    } catch (error) {
      console.error('❌ [REDIS] Failed to get all pipe transports:', error);
      return [];
    }
  }

  // Pipe Producer Management
  async storePipeProducer(pipeProducerData) {
    if (!this.connected) return false;
    
    try {
      const key = `producer:${pipeProducerData.originalProducerId}:${pipeProducerData.targetNode}`;
      await this.client.hSet(key, {
        pipeProducerId: pipeProducerData.pipeProducerId,
        originalProducerId: pipeProducerData.originalProducerId,
        sourceNode: pipeProducerData.sourceNode,
        targetNode: pipeProducerData.targetNode,
        transportId: pipeProducerData.transportId,
        kind: pipeProducerData.kind,
        roomId: pipeProducerData.roomId,
        participantId: pipeProducerData.participantId,
        createdAt: new Date().toISOString()
      });
      
      console.log(`📝 [REDIS] Stored pipe producer: ${pipeProducerData.originalProducerId} -> ${pipeProducerData.pipeProducerId} on ${pipeProducerData.targetNode}`);
      return true;
    } catch (error) {
      console.error('❌ [REDIS] Failed to store pipe producer:', error);
      return false;
    }
  }

  async getPipeProducer(originalProducerId, targetNode) {
    if (!this.connected) return null;
    
    try {
      const key = `producer:${originalProducerId}:${targetNode}`;
      const data = await this.client.hGetAll(key);
      
      if (!data || !data.pipeProducerId) {
        return null;
      }

      return {
        pipeProducerId: data.pipeProducerId,
        originalProducerId: data.originalProducerId,
        sourceNode: data.sourceNode,
        targetNode: data.targetNode,
        transportId: data.transportId,
        kind: data.kind,
        roomId: data.roomId,
        participantId: data.participantId,
        createdAt: data.createdAt
      };
    } catch (error) {
      console.error('❌ [REDIS] Failed to get pipe producer:', error);
      return null;
    }
  }

  async setPipeProducer(key, pipeProducerData) {
    if (!this.connected) return false;
    
    try {
      await this.client.hSet(key, {
        pipeProducerId: pipeProducerData.pipeProducerId,
        originalProducerId: pipeProducerData.originalProducerId,
        sourceNodeId: pipeProducerData.sourceNodeId,
        targetNodeId: pipeProducerData.targetNodeId,
        roomId: pipeProducerData.roomId,
        participantId: pipeProducerData.participantId,
        kind: pipeProducerData.kind,
        rtpParameters: JSON.stringify(pipeProducerData.rtpParameters),
        streamId: pipeProducerData.streamId,
        streamName: pipeProducerData.streamName,
        localTransportId: pipeProducerData.localTransportId,
        remoteTransportId: pipeProducerData.remoteTransportId,
        createdAt: new Date().toISOString()
      });
      
      console.log(`📝 [REDIS] Stored pipe producer: ${key}`);
      return true;
    } catch (error) {
      console.error('❌ [REDIS] Failed to store pipe producer:', error);
      return false;
    }
  }

  // Stream Routing
  async registerStream(streamData) {
    if (!this.connected) return false;
    
    try {
      const key = `stream:${streamData.roomId}:${streamData.participantId}`;
      await this.client.hSet(key, {
        streamId: streamData.streamId,
        participantId: streamData.participantId,
        roomId: streamData.roomId,
        sourceNode: streamData.sourceNode,
        hasAudio: streamData.hasAudio.toString(),
        hasVideo: streamData.hasVideo.toString(),
        audioProducerId: streamData.audioProducerId || '',
        videoProducerId: streamData.videoProducerId || '',
        createdAt: new Date().toISOString()
      });
      
      console.log(`📝 [REDIS] Registered stream: ${streamData.streamId} on ${streamData.sourceNode}`);
      return true;
    } catch (error) {
      console.error('❌ [REDIS] Failed to register stream:', error);
      return false;
    }
  }

  async getActiveStreams(roomId = null) {
    if (!this.connected) return [];
    
    try {
      const pattern = roomId ? `stream:${roomId}:*` : 'stream:*';
      const keys = await this.client.keys(pattern);
      const streams = [];
      
      for (const key of keys) {
        const data = await this.client.hGetAll(key);
        if (data && data.streamId) {
          streams.push({
            streamId: data.streamId,
            participantId: data.participantId,
            roomId: data.roomId,
            sourceNode: data.sourceNode,
            hasAudio: data.hasAudio === 'true',
            hasVideo: data.hasVideo === 'true',
            audioProducerId: data.audioProducerId || null,
            videoProducerId: data.videoProducerId || null,
            createdAt: data.createdAt
          });
        }
      }
      
      return streams;
    } catch (error) {
      console.error('❌ [REDIS] Failed to get active streams:', error);
      return [];
    }
  }

  // Node Status Management
  async updateNodeStatus(nodeData) {
    if (!this.connected) return false;
    
    try {
      await this.client.hSet(`node:${this.nodeId}`, {
        id: nodeData.id,
        host: nodeData.host,
        port: nodeData.port.toString(),
        status: 'active',
        lastSeen: new Date().toISOString(),
        rooms: nodeData.rooms?.toString() || '0',
        participants: nodeData.participants?.toString() || '0'
      });
      
      return true;
    } catch (error) {
      console.error('❌ [REDIS] Failed to update node status:', error);
      return false;
    }
  }

  async getActiveNodes() {
    if (!this.connected) return [];
    
    try {
      const keys = await this.client.keys('node:*');
      const nodes = [];
      
      for (const key of keys) {
        const data = await this.client.hGetAll(key);
        if (data && data.id && data.status === 'active') {
          // Consider node active if seen within last 30 seconds
          const lastSeen = new Date(data.lastSeen);
          const now = new Date();
          if (now - lastSeen < 30000) {
            nodes.push({
              id: data.id,
              host: data.host,
              port: parseInt(data.port),
              status: data.status,
              lastSeen: data.lastSeen,
              rooms: parseInt(data.rooms || '0'),
              participants: parseInt(data.participants || '0')
            });
          }
        }
      }
      
      return nodes;
    } catch (error) {
      console.error('❌ [REDIS] Failed to get active nodes:', error);
      return [];
    }
  }

  /**
   * Clear old pipe transport state for this node on startup
   */
  async clearNodeState() {
    if (!this.connected) {
      throw new Error('Redis client not connected');
    }

    try {
      // Clear all pipe transport keys for this node
      const keys = await this.client.keys(`pipe:${this.nodeId}:*`);
      const reverseKeys = await this.client.keys(`pipe:*:${this.nodeId}`);
      const allKeys = [...keys, ...reverseKeys];
      
      if (allKeys.length > 0) {
        await this.client.del(allKeys);
        console.log(`🧹 [REDIS] Cleared ${allKeys.length} old pipe transport keys for node ${this.nodeId}`);
      }
      
      // Clear old producer state for this node
      const producerKeys = await this.client.keys(`producer:${this.nodeId}:*`);
      if (producerKeys.length > 0) {
        await this.client.del(producerKeys);
        console.log(`🧹 [REDIS] Cleared ${producerKeys.length} old producer keys for node ${this.nodeId}`);
      }
      
    } catch (error) {
      console.error('❌ [REDIS] Failed to clear node state:', error);
      throw error;
    }
  }

  // Cleanup methods
  async cleanupExpiredData() {
    if (!this.connected) return;
    
    try {
      // Remove nodes not seen in last 60 seconds
      const nodeKeys = await this.client.keys('node:*');
      const cutoff = new Date(Date.now() - 60000);
      
      for (const key of nodeKeys) {
        const data = await this.client.hGetAll(key);
        if (data && data.lastSeen) {
          const lastSeen = new Date(data.lastSeen);
          if (lastSeen < cutoff) {
            await this.client.del(key);
            console.log(`🧹 [REDIS] Cleaned up expired node: ${key}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ [REDIS] Failed to cleanup expired data:', error);
    }
  }
}

module.exports = RedisMeshState;
