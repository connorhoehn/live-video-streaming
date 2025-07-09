/**
 * Enhanced Transport Manager - Handles WebRTC and Pipe transports
 * Integrated from sample_cluster architecture
 */

const EventEmitter = require('events');


class TransportManager extends EventEmitter {
  constructor(router, config = {}) {
    super();
    this.router = router;
    this.config = {
      maxIncomingBitrate: config.maxIncomingBitrate || 1500000,
      initialAvailableOutgoingBitrate: config.initialAvailableOutgoingBitrate || 1000000,
      minimumAvailableOutgoingBitrate: config.minimumAvailableOutgoingBitrate || 600000,
      listenIps: config.listenIps || [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1'
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      ...config
    };

    this.transports = new Map();
    this.pipeTransports = new Map();
  }
  /**
   * Create WebRTC Producer Transport
   */
  async createProducerTransport(options = {}) {
    try {
      const transport = await this.router.createWebRtcTransport({
        listenIps: this.config.listenIps,
        enableUdp: this.config.enableUdp,
        enableTcp: this.config.enableTcp,
        preferUdp: this.config.preferUdp,
        initialAvailableOutgoingBitrate: this.config.initialAvailableOutgoingBitrate,
        ...options
      });

      // Set max incoming bitrate
      if (this.config.maxIncomingBitrate) {
        try {
          await transport.setMaxIncomingBitrate(this.config.maxIncomingBitrate);
        } catch (error) {
          console.warn(`⚠️  Failed to set maxIncomingBitrate: ${error.message}`);
        }
      }

      this.transports.set(transport.id, {
        transport,
        type: 'producer',
        createdAt: new Date(),
        roomId: options.roomId,
        participantId: options.participantId
      });

      console.log(`🚛 Producer transport created: ${transport.id}`);
      this.emit('transportCreated', {
        transportId: transport.id,
        type: 'producer',
        roomId: options.roomId,
        participantId: options.participantId
      });

      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        transport
      };
    } catch (error) {
      console.error('❌ Failed to create producer transport:', error);
      throw error;
    }
  }

  /**
   * Create WebRTC Consumer Transport
   */
  async createConsumerTransport(options = {}) {
    try {
      const transport = await this.router.createWebRtcTransport({
        listenIps: this.config.listenIps,
        enableUdp: this.config.enableUdp,
        enableTcp: this.config.enableTcp,
        preferUdp: this.config.preferUdp,
        initialAvailableOutgoingBitrate: this.config.initialAvailableOutgoingBitrate,
        ...options
      });

      // Set max incoming bitrate
      if (this.config.maxIncomingBitrate) {
        try {
          await transport.setMaxIncomingBitrate(this.config.maxIncomingBitrate);
        } catch (error) {
          console.warn(`⚠️  Failed to set maxIncomingBitrate: ${error.message}`);
        }
      }

      this.transports.set(transport.id, {
        transport,
        type: 'consumer',
        createdAt: new Date(),
        roomId: options.roomId,
        participantId: options.participantId
      });

      console.log(`🚛 Consumer transport created: ${transport.id}`);
      this.emit('transportCreated', {
        transportId: transport.id,
        type: 'consumer',
        roomId: options.roomId,
        participantId: options.participantId
      });

      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        transport
      };
    } catch (error) {
      console.error('❌ Failed to create consumer transport:', error);
      throw error;
    }
  }

  /**
   * Create Pipe Transport for cross-node communication
   */
  async createPipeTransport(options = {}) {
    try {
      // Use specified router or default to this.router
      const router = options.router || this.router;
      
      // Validate that we have a proper Mediasoup Router instance
      if (!router || typeof router.createPipeTransport !== 'function') {
        throw new Error(`Invalid router provided to createPipeTransport. Router must be a Mediasoup Router instance.`);
      }
      
      // Debug: Check router methods to ensure it's a proper Mediasoup router
      console.log(`🔍 [DEBUG] Creating pipe transport with router ${router.id}`);
      console.log(`🔍 [DEBUG] Router has required methods:`, {
        createPipeTransport: typeof router.createPipeTransport === 'function',
        getProducers: typeof router.getProducers === 'function',
        canConsume: typeof router.canConsume === 'function'
      });
      
      // Create pipe transport using proper Mediasoup v3 API
      const pipeTransportOptions = {
        listenInfo: {
          protocol: 'udp',
          ip: options.listenIp || this.config.listenIps[0].ip,
          port: options.port
        },
        enableSctp: options.enableSctp !== undefined ? options.enableSctp : true,
        numSctpStreams: options.numSctpStreams || { OS: 1024, MIS: 1024 },
        enableRtx: options.enableRtx || false,
        enableSrtp: options.enableSrtp || false,
        appData: options.appData || {}
      };

      const transport = await router.createPipeTransport(pipeTransportOptions);

      // Store the pipe transport with the router reference
      this.pipeTransports.set(transport.id, {
        transport,
        router, // Store the actual Mediasoup Router instance
        type: 'pipe',
        createdAt: new Date(),
        sourceNode: options.sourceNode,
        destinationNode: options.destinationNode
      });

      console.log(`🔗 Pipe transport created: ${transport.id} for router ${router.id}`);
      this.emit('pipeTransportCreated', {
        transportId: transport.id,
        sourceNode: options.sourceNode,
        destinationNode: options.destinationNode
      });

      return {
        id: transport.id,
        ip: transport.tuple.localIp,
        port: transport.tuple.localPort,
        srtpParameters: transport.srtpParameters,
        transport
      };
    } catch (error) {
      console.error('❌ Failed to create pipe transport:', error);
      throw error;
    }
  }

  /**
   * Connect WebRTC transport
   */
  async connectTransport(transportId, dtlsParameters) {
    const transportInfo = this.transports.get(transportId);
    if (!transportInfo) {
      throw new Error(`Transport ${transportId} not found`);
    }

    try {
      await transportInfo.transport.connect({ dtlsParameters });
      console.log(`🔗 Transport connected: ${transportId}`);
      this.emit('transportConnected', { transportId, type: transportInfo.type });
      return { success: true };
    } catch (error) {
      console.error(`❌ Failed to connect transport ${transportId}:`, error);
      throw error;
    }
  }

  /**
   * Connect Pipe transport
   */
  async connectPipeTransport(transportId, connectOptions) {
    const transportInfo = this.pipeTransports.get(transportId);
    if (!transportInfo) {
      throw new Error(`Pipe transport ${transportId} not found`);
    }

    try {
      await transportInfo.transport.connect(connectOptions);
      console.log(`🔗 Pipe transport connected: ${transportId}`);
      this.emit('pipeTransportConnected', { transportId });
      return { success: true };
    } catch (error) {
      console.error(`❌ Failed to connect pipe transport ${transportId}:`, error);
      throw error;
    }
  }

  /**
   * Create producer on transport
   */
  async createProducer(transportId, producerOptions) {
    const transportInfo = this.transports.get(transportId);
    if (!transportInfo) {
      throw new Error(`Transport ${transportId} not found`);
    }

    if (transportInfo.type !== 'producer') {
      throw new Error(`Transport ${transportId} is not a producer transport`);
    }

    try {
      const producer = await transportInfo.transport.produce(producerOptions);
      
      // Store producer in transport appData for easy retrieval
      if (!transportInfo.transport.appData) {
        transportInfo.transport.appData = {};
      }
      if (!transportInfo.transport.appData.producers) {
        transportInfo.transport.appData.producers = new Map();
      }
      transportInfo.transport.appData.producers.set(producer.id, producer);
      
      console.log(`📤 Producer created: ${producer.id} on transport ${transportId}`);
      this.emit('producerCreated', {
        producerId: producer.id,
        transportId,
        kind: producer.kind,
        roomId: transportInfo.roomId,
        participantId: transportInfo.participantId
      });

      return {
        id: producer.id,
        kind: producer.kind,
        producer
      };
    } catch (error) {
      console.error(`❌ Failed to create producer on transport ${transportId}:`, error);
      throw error;
    }
  }

  /**
   * Create consumer on transport
   */
  async createConsumer(transportId, consumerOptions) {
    const transportInfo = this.transports.get(transportId);
    if (!transportInfo) {
      throw new Error(`Transport ${transportId} not found`);
    }

    if (transportInfo.type !== 'consumer') {
      throw new Error(`Transport ${transportId} is not a consumer transport`);
    }

    try {
      const consumer = await transportInfo.transport.consume(consumerOptions);
      
      // Store consumer in transport appData for easy retrieval
      if (!transportInfo.transport.appData) {
        transportInfo.transport.appData = {};
      }
      if (!transportInfo.transport.appData.consumers) {
        transportInfo.transport.appData.consumers = new Map();
      }
      transportInfo.transport.appData.consumers.set(consumer.id, consumer);
      
      console.log(`📥 Consumer created: ${consumer.id} on transport ${transportId}`);
      this.emit('consumerCreated', {
        consumerId: consumer.id,
        transportId,
        producerId: consumerOptions.producerId,
        kind: consumer.kind,
        roomId: transportInfo.roomId,
        participantId: transportInfo.participantId
      });

      return {
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
        consumer
      };
    } catch (error) {
      console.error(`❌ Failed to create consumer on transport ${transportId}:`, error);
      throw error;
    }
  }

  /**
   * Create pipe producer (for cross-node communication)
   */
  async createPipeProducer(transportId, pipeOptions) {
    const transportInfo = this.pipeTransports.get(transportId);
    if (!transportInfo) {
      throw new Error(`Pipe transport ${transportId} not found`);
    }

    try {
      const pipeProducer = await transportInfo.transport.produce(pipeOptions);
      
      console.log(`🔗 Pipe producer created: ${pipeProducer.id} on transport ${transportId}`);
      this.emit('pipeProducerCreated', {
        pipeProducerId: pipeProducer.id,
        transportId,
        originalProducerId: pipeOptions.id
      });

      return {
        id: pipeProducer.id,
        kind: pipeProducer.kind,
        producer: pipeProducer
      };
    } catch (error) {
      console.error(`❌ Failed to create pipe producer on transport ${transportId}:`, error);
      throw error;
    }
  }

  /**
   * Create pipe consumer (for cross-node communication)
   */
  /**
   * Create pipe consumer using canonical Mediasoup v3 pattern
   * This method assumes the producer is already available on the router
   * connected to the pipe transport (either locally or piped from another router)
   */
  async createPipeConsumer(transportId, consumerOptions) {
    console.log(`🔍 [TRANSPORT] Creating pipe consumer:`, {
      transportId,
      consumerOptions,
      optionsType: typeof consumerOptions
    });

    const transportInfo = this.pipeTransports.get(transportId);
    if (!transportInfo) {
      console.error(`❌ [TRANSPORT] Pipe transport ${transportId} not found.`);
      throw new Error(`Pipe transport ${transportId} not found`);
    }

    try {
      const producerId = consumerOptions.producerId || consumerOptions;
      console.log(`🔍 [TRANSPORT] Creating pipe consumer with producerId: ${producerId}`);

      // Follow the canonical Mediasoup v3 pattern: transport.consume({ producerId })
      const pipeConsumer = await transportInfo.transport.consume({ producerId });
      
      if (!pipeConsumer) {
        console.error(`❌ [TRANSPORT] Pipe consumer creation returned undefined for producer ${producerId}`);
        throw new Error(`Failed to create pipe consumer for producer ${producerId}`);
      }

      console.log(`🔗 Pipe consumer created: ${pipeConsumer.id} on transport ${transportId}`);
      this.emit('pipeConsumerCreated', {
        pipeConsumerId: pipeConsumer.id,
        transportId,
        producerId
      });

      return {
        id: pipeConsumer.id,
        kind: pipeConsumer.kind,
        rtpParameters: pipeConsumer.rtpParameters,
        paused: pipeConsumer.producerPaused,
        consumer: pipeConsumer
      };
    } catch (error) {
      console.error(`❌ Failed to create pipe consumer on transport ${transportId}:`, error);
      throw error;
    }
  }

  /**
   * Close transport
   */
  async closeTransport(transportId) {
    const webrtcTransport = this.transports.get(transportId);
    const pipeTransport = this.pipeTransports.get(transportId);
    
    const transportInfo = webrtcTransport || pipeTransport;
    if (!transportInfo) {
      return false;
    }

    try {
      transportInfo.transport.close();
      
      if (webrtcTransport) {
        this.transports.delete(transportId);
      } else {
        this.pipeTransports.delete(transportId);
      }

      console.log(`🗑️  Transport closed: ${transportId}`);
      this.emit('transportClosed', { transportId, type: transportInfo.type });
      return true;
    } catch (error) {
      console.error(`❌ Failed to close transport ${transportId}:`, error);
      return false;
    }
  }

  /**
   * Get transport by ID
   */
  getTransport(transportId) {
    return this.transports.get(transportId) || this.pipeTransports.get(transportId);
  }

  /**
   * Get all transports for a room
   */
  getRoomTransports(roomId) {
    const roomTransports = [];
    
    for (const [transportId, transportInfo] of this.transports.entries()) {
      if (transportInfo.roomId === roomId) {
        roomTransports.push({
          id: transportId,
          ...transportInfo
        });
      }
    }
    
    return roomTransports;
  }

  /**
   * Get all transports for a participant
   */
  getParticipantTransports(participantId) {
    const participantTransports = [];
    
    for (const [transportId, transportInfo] of this.transports.entries()) {
      if (transportInfo.participantId === participantId) {
        participantTransports.push({
          id: transportId,
          ...transportInfo
        });
      }
    }
    
    return participantTransports;
  }

  /**
   * Get transport statistics
   */
  async getTransportStats(transportId) {
    const transportInfo = this.getTransport(transportId);
    if (!transportInfo) {
      return null;
    }

    try {
      const stats = await transportInfo.transport.getStats();
      return {
        transportId,
        type: transportInfo.type,
        createdAt: transportInfo.createdAt,
        stats
      };
    } catch (error) {
      console.error(`❌ Failed to get stats for transport ${transportId}:`, error);
      return null;
    }
  }

  /**
   * Get global transport statistics
   */
  getGlobalStats() {
    return {
      totalWebRtcTransports: this.transports.size,
      totalPipeTransports: this.pipeTransports.size,
      producerTransports: Array.from(this.transports.values()).filter(t => t.type === 'producer').length,
      consumerTransports: Array.from(this.transports.values()).filter(t => t.type === 'consumer').length,
      transportsByRoom: this.getTransportsByRoom(),
      transportsByParticipant: this.getTransportsByParticipant()
    };
  }

  /**
   * Helper: Get transports grouped by room
   */
  getTransportsByRoom() {
    const byRoom = {};
    for (const [transportId, transportInfo] of this.transports.entries()) {
      if (transportInfo.roomId) {
        if (!byRoom[transportInfo.roomId]) {
          byRoom[transportInfo.roomId] = [];
        }
        byRoom[transportInfo.roomId].push({
          id: transportId,
          type: transportInfo.type,
          participantId: transportInfo.participantId
        });
      }
    }
    return byRoom;
  }

  /**
   * Helper: Get transports grouped by participant
   */
  getTransportsByParticipant() {
    const byParticipant = {};
    for (const [transportId, transportInfo] of this.transports.entries()) {
      if (transportInfo.participantId) {
        if (!byParticipant[transportInfo.participantId]) {
          byParticipant[transportInfo.participantId] = [];
        }
        byParticipant[transportInfo.participantId].push({
          id: transportId,
          type: transportInfo.type,
          roomId: transportInfo.roomId
        });
      }
    }
    return byParticipant;
  }

  /**
   * Clean up all transports
   */
  async cleanup() {
    console.log(`🧹 Cleaning up ${this.transports.size} WebRTC transports and ${this.pipeTransports.size} pipe transports`);
    
    // Close all WebRTC transports
    for (const [transportId, transport] of this.transports) {
      try {
        transport.close();
        this.emit('transportClosed', { transportId });
      } catch (err) {
        console.error(`Error closing transport ${transportId}:`, err);
      }
    }
    
    // Clear the transports map
    this.transports.clear();
    
    // Close all pipe transports
    for (const [transportId, transport] of this.pipeTransports) {
      try {
        transport.close();
      } catch (err) {
        console.error(`Error closing pipe transport ${transportId}:`, err);
      }
    }
    
    // Clear the pipe transports map
    this.pipeTransports.clear();
    
    console.log('✅ All transports cleaned up');
  }
  
  /**
   * Statistics methods for health checks
   */
  getTransportCount() {
    return this.transports.size;
  }

  getPipeTransportCount() {
    return this.pipeTransports.size;
  }

  getProducerCount() {
    let count = 0;
    for (const transport of this.transports.values()) {
      if (transport.appData && transport.appData.producers) {
        count += transport.appData.producers.size;
      }
    }
    return count;
  }
  
  getConsumerCount() {
    let count = 0;
    for (const transport of this.transports.values()) {
      if (transport.appData && transport.appData.consumers) {
        count += transport.appData.consumers.size;
      }
    }
    return count;
  }

  /**
   * Check if a transport can consume a producer
   */
  canConsume(transportId, { producerId, rtpCapabilities }) {
    const transport = this.getTransport(transportId);
    if (!transport) return false;
    
    // Get producer
    const producer = this.getProducer(producerId);
    if (!producer) {
      console.error(`❌ Producer ${producerId} not found for canConsume check`);
      return false;
    }
    
    // Check if router can consume
    try {
      return this.router.canConsume({
        producerId,
        rtpCapabilities
      });
    } catch (error) {
      console.error(`❌ Router canConsume failed:`, error);
      return false;
    }
  }
  
  /**
   * Resume a consumer
   */
  async resumeConsumer(consumerId) {
    // Find transport that has this consumer
    for (const [transportId, transport] of this.transports.entries()) {
      if (transport.appData && transport.appData.consumers) {
        const consumer = transport.appData.consumers.get(consumerId);
        if (consumer) {
          await consumer.resume();
          return true;
        }
      }
    }
    
    throw new Error(`Consumer ${consumerId} not found`);
  }

  /**
   * Get producer by ID
   */
  getProducer(producerId) {
    // Search through all transports for the producer
    for (const [transportId, transportInfo] of this.transports.entries()) {
      if (transportInfo.transport && transportInfo.transport.appData && transportInfo.transport.appData.producers) {
        const producer = transportInfo.transport.appData.producers.get(producerId);
        if (producer) {
          return producer;
        }
      }
    }
    return null;
  }

  /**
   * Get producer by ID (alias for compatibility)
   */
  getProducerById(producerId) {
    return this.getProducer(producerId);
  }

  /**
   * Get consumer by ID
   */
  getConsumer(consumerId) {
    // Search through all transports for the consumer
    for (const [transportId, transportInfo] of this.transports.entries()) {
      if (transportInfo.transport && transportInfo.transport.appData && transportInfo.transport.appData.consumers) {
        const consumer = transportInfo.transport.appData.consumers.get(consumerId);
        if (consumer) {
          return consumer;
        }
      }
    }
    return null;
  }

  /**
   * Get pipe transport by ID
   */
  getPipeTransport(transportId) {
    return this.pipeTransports.get(transportId);
  }
}

module.exports = TransportManager;
