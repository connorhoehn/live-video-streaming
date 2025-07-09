class PeerManager {
  constructor() {
    this.peers = new Map();
    this.connectionStats = {
      totalConnections: 0,
      activeConnections: 0,
      totalDataTransferred: 0
    };
    this.activeConnections = new Map(); // Track active socket connections
    this.streamMapping = new Map(); // Track stream mappings
  }

  addPeer(socketId, peerInfo) {
    const peer = {
      socketId,
      ...peerInfo,
      connectedAt: new Date(),
      transports: new Set(),
      producers: new Set(),
      consumers: new Set(),
      rooms: new Set(),
      lastActivity: new Date()
    };

    this.peers.set(socketId, peer);
    this.connectionStats.totalConnections++;
    this.connectionStats.activeConnections++;

    console.log(`👤 [PEER] Added peer ${socketId} (${peerInfo.clientIp})`);
    return peer;
  }

  removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      this.peers.delete(socketId);
      this.connectionStats.activeConnections--;
      console.log(`👤 [PEER] Removed peer ${socketId}`);
      return peer;
    }
    return null;
  }

  getPeer(socketId) {
    return this.peers.get(socketId);
  }

  getAllPeers() {
    return Array.from(this.peers.values());
  }

  addTransportToPeer(socketId, transportId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.transports.add(transportId);
      peer.lastActivity = new Date();
    }
  }

  addProducerToPeer(socketId, producerId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.producers.add(producerId);
      peer.lastActivity = new Date();
    }
  }

  addConsumerToPeer(socketId, consumerId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.consumers.add(consumerId);
      peer.lastActivity = new Date();
    }
  }

  addRoomToPeer(socketId, roomId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.rooms.add(roomId);
      peer.lastActivity = new Date();
    }
  }

  removeTransportFromPeer(socketId, transportId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.transports.delete(transportId);
    }
  }

  removeProducerFromPeer(socketId, producerId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.producers.delete(producerId);
    }
  }

  removeConsumerFromPeer(socketId, consumerId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.consumers.delete(consumerId);
    }
  }

  removeRoomFromPeer(socketId, roomId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.rooms.delete(roomId);
    }
  }

  // Socket connection management
  addConnection(socketId, connectionInfo) {
    this.activeConnections.set(socketId, {
      ...connectionInfo,
      connectedAt: Date.now()
    });
    console.log(`🔗 [PEER] Socket connected: ${socketId}`);
  }

  removeConnection(socketId) {
    const connection = this.activeConnections.get(socketId);
    if (connection) {
      this.activeConnections.delete(socketId);
      console.log(`🔗 [PEER] Socket disconnected: ${socketId}`);
      return connection;
    }
    return null;
  }

  getConnection(socketId) {
    return this.activeConnections.get(socketId);
  }

  // Stream mapping management
  addStreamMapping(streamId, mapping) {
    this.streamMapping.set(streamId, mapping);
    console.log(`📺 [PEER] Stream mapped: ${streamId}`);
  }

  removeStreamMapping(streamId) {
    const mapping = this.streamMapping.get(streamId);
    if (mapping) {
      this.streamMapping.delete(streamId);
      console.log(`📺 [PEER] Stream unmapped: ${streamId}`);
      return mapping;
    }
    return null;
  }

  getStreamMapping(streamId) {
    return this.streamMapping.get(streamId);
  }

  getAllStreamMappings() {
    return Array.from(this.streamMapping.entries());
  }

  // Enhanced peer management with room support
  addPeerToRoom(socketId, roomId, peerInfo) {
    const peer = this.getPeer(socketId);
    if (peer) {
      peer.rooms.add(roomId);
      peer.currentRoom = roomId;
      peer.lastActivity = new Date();
      console.log(`👤 [PEER] Added peer ${socketId} to room ${roomId}`);
      return peer;
    }
    return null;
  }

  removePeerFromRoom(socketId, roomId) {
    const peer = this.getPeer(socketId);
    if (peer) {
      peer.rooms.delete(roomId);
      if (peer.currentRoom === roomId) {
        peer.currentRoom = null;
      }
      console.log(`👤 [PEER] Removed peer ${socketId} from room ${roomId}`);
      return peer;
    }
    return null;
  }

  getPeersInRoom(roomId) {
    return Array.from(this.peers.values()).filter(peer => peer.rooms.has(roomId));
  }

  getConnectionStats() {
    return {
      ...this.connectionStats,
      activePeers: this.peers.size,
      totalTransports: Array.from(this.peers.values()).reduce((sum, peer) => sum + peer.transports.size, 0),
      totalProducers: Array.from(this.peers.values()).reduce((sum, peer) => sum + peer.producers.size, 0),
      totalConsumers: Array.from(this.peers.values()).reduce((sum, peer) => sum + peer.consumers.size, 0)
    };
  }

  getActivePeerCount() {
    return this.connectionStats.activeConnections;
  }

  cleanupPeerResources(socketId, transports, producers, consumers) {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    const resourceCount = peer.transports.size + peer.producers.size + peer.consumers.size;
    console.log(`🧹 [PEER CLEANUP] Cleaning up ${resourceCount} resources for peer ${socketId}`);

    // Clean up transports
    peer.transports.forEach(transportId => {
      const transport = transports.get(transportId);
      if (transport) {
        console.log(`🚛 [CLEANUP] Closing transport ${transportId}`);
        transport.transport.close();
        transports.delete(transportId);
      }
    });

    // Clean up producers
    peer.producers.forEach(producerId => {
      const producer = producers.get(producerId);
      if (producer) {
        console.log(`📤 [CLEANUP] Closing producer ${producerId}`);
        producer.producer.close();
        producers.delete(producerId);
      }
    });

    // Clean up consumers
    peer.consumers.forEach(consumerId => {
      const consumer = consumers.get(consumerId);
      if (consumer) {
        console.log(`📥 [CLEANUP] Closing consumer ${consumerId}`);
        consumer.consumer.close();
        consumers.delete(consumerId);
      }
    });
  }
}

module.exports = PeerManager;
