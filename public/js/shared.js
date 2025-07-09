// Shared utilities for both streamer and viewer
class MediaSoupClient {
  constructor() {
    this.socket = null;
    this.device = null;
    this.rtpCapabilities = null;
    this.producerTransport = null;
    this.consumerTransport = null;
    this.producers = new Map();
    this.consumers = new Map();
    this.isConnected = false;
    this.selectedSfuNode = null;
    this.eventHandlers = new Map();
  }

  // Event handling
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => handler(data));
    }
  }

  // Connect to signaling server
  async connect(nodeId = 'sfu1') {
    try {
      // Connect to specific SFU node
      const nodePort = this.getNodePort(nodeId);
      this.socket = io(`http://localhost:${nodePort}`);
      
      // Set the selected SFU node
      this.selectedSfuNode = {
        nodeId,
        host: 'localhost',
        port: nodePort,
        connections: 0
      };
      
      Logger.info(`🎯 Connecting to SFU node: ${nodeId} (port: ${nodePort})`);
      
      this.socket.on('connect', () => {
        Logger.info(`Connected to SFU node: ${nodeId}`);
        this.isConnected = true;
        this.emit('connected', { nodeId, port: nodePort });
      });

      this.socket.on('disconnect', () => {
        Logger.warning(`Disconnected from SFU node: ${nodeId}`);
        this.isConnected = false;
        this.emit('disconnected', { nodeId });
      });

      this.socket.on('sfu-nodes', (nodes) => {
        Logger.info(`Available SFU nodes: ${nodes.map(n => n.nodeId).join(', ')}`);
        this.emit('sfu-nodes', nodes);
      });

      this.socket.on('mesh-update', (meshData) => {
        Logger.info('Received mesh update from signaling server');
        this.emit('mesh-update', meshData);
      });

      // Wait for connection
      await new Promise((resolve) => {
        if (this.isConnected) resolve();
        else this.socket.on('connect', resolve);
      });

      return true;
    } catch (error) {
      Logger.error('Failed to connect to signaling server:', error);
      return false;
    }
  }

  // Select SFU node with smart multi-node logic
  async selectSfuNode(operation = 'produce', streamId = null, excludeNodes = []) {
    try {
      // For now, default to SFU1 since we don't have a load balancer
      // In a full implementation, this would query the coordinator
      const defaultNode = {
        nodeId: 'sfu1',
        host: 'localhost',
        port: 3001,
        connections: 0
      };

      this.selectedSfuNode = defaultNode;
      Logger.info(`🎯 Selected SFU node: ${defaultNode.nodeId} (default selection)`);
      
      return defaultNode;
    } catch (error) {
      Logger.error('Failed to select SFU node:', error);
      
      // Fallback to basic selection
      return new Promise((resolve) => {
        this.socket.emit('get-sfu-nodes');
        this.socket.once('sfu-nodes', (nodes) => {
          if (nodes.length === 0) {
            Logger.error('No SFU nodes available');
            resolve(null);
            return;
          }

          // Filter out excluded nodes
          const availableNodes = nodes.filter(node => !excludeNodes.includes(node.nodeId));
          if (availableNodes.length === 0) {
            Logger.warn('All nodes excluded, using any available node');
            availableNodes.push(...nodes);
          }

          // Select node with least connections
          const bestNode = availableNodes.reduce((best, current) => 
            current.connections < best.connections ? current : best
          );

          this.selectedSfuNode = bestNode;
          Logger.info(`🔄 Fallback selected SFU node: ${bestNode.nodeId} (${bestNode.connections} connections)`);
          resolve(bestNode);
        });
      });
    }
  }

  // Get router RTP capabilities
  async getRtpCapabilities() {
    if (!this.selectedSfuNode) {
      throw new Error('No SFU node selected');
    }

    const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/router-rtp-capabilities`);
    if (!response.ok) {
      throw new Error('Failed to get RTP capabilities');
    }

    this.rtpCapabilities = await response.json();
    Logger.info('Retrieved RTP capabilities');
    return this.rtpCapabilities;
  }

  // Create device
  async createDevice() {
    try {
      // Check if mediasoup-client is available
      if (typeof window !== 'undefined' && window.mediasoupClient) {
        Logger.info('Real mediasoup-client detected, creating real device');
        this.device = new window.mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
        Logger.info('✅ Created real MediaSoup device');
        return this.device;
      } else if (typeof mediasoupClient !== 'undefined') {
        Logger.info('mediasoupClient global detected, creating real device');
        this.device = new mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
        Logger.info('✅ Created real MediaSoup device');
        return this.device;
      } else {
        Logger.warning('⚠️ Real mediasoup-client not available, checking for fallback...');
        throw new Error('MediaSoup client not loaded');
      }
    } catch (error) {
      Logger.warning('❌ Failed to create real device, using mock:', error.message);
      this.device = new MockMediaSoupDevice(this.rtpCapabilities);
      Logger.info('🎭 Created mock MediaSoup device');
      return this.device;
    }
  }

  // Create WebRTC transport
  async createTransport(type) {
    const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/create-transport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to create transport');
    }

    const params = await response.json();
    Logger.info(`Created ${type} transport: ${params.id}`);

    let transport;
    if (this.device.mock) {
      transport = new MockTransport(params, type, this);
    } else {
      if (type === 'producer') {
        transport = this.device.createSendTransport(params);
      } else {
        transport = this.device.createRecvTransport(params);
      }
    }

    // Connect transport
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        // Debug DTLS parameters
        console.log(`🔐 [CLIENT] Connecting ${type} transport with DTLS parameters:`, dtlsParameters);
        
        if (!dtlsParameters || !dtlsParameters.fingerprints || dtlsParameters.fingerprints.length === 0) {
          console.error(`❌ [CLIENT] Invalid DTLS parameters for ${type} transport:`, dtlsParameters);
          throw new Error(`Invalid DTLS parameters for ${type} transport - empty fingerprints`);
        }
        
        console.log(`🔐 [CLIENT] DTLS fingerprints (${dtlsParameters.fingerprints.length}):`, 
                    dtlsParameters.fingerprints.map(fp => `${fp.algorithm}:${fp.value}`));
        
        const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/connect-transport`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transportId: params.id,
            dtlsParameters
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to connect transport: ${response.status} ${errorText}`);
        }

        Logger.info(`Connected ${type} transport`);
        callback();
      } catch (error) {
        Logger.error(`Failed to connect ${type} transport:`, error);
        errback(error);
      }
    });

    return transport;
  }

  // Create producer transport
  async createProducerTransport() {
    this.producerTransport = await this.createTransport('producer');
    
    // Add produce event handler for real transports
    this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/produce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transportId: this.producerTransport.id,
            kind,
            rtpParameters,
            streamId: this.currentStreamId // Include stream ID if available
          })
        });

        if (!response.ok) {
          throw new Error('Failed to create producer');
        }

        const { id } = await response.json();
        Logger.success(`Created producer: ${id} (${kind})`);
        callback({ id });
      } catch (error) {
        Logger.error('Failed to create producer:', error);
        errback(error);
      }
    });

    return this.producerTransport;
  }

  // Create consumer transport
  async createConsumerTransport() {
    this.consumerTransport = await this.createTransport('consumer');
    return this.consumerTransport;
  }

  // Produce media
  async produce(stream) {
    if (!this.producerTransport) {
      await this.createProducerTransport();
    }

    const producers = [];

    for (const track of stream.getTracks()) {
      try {
        const producer = await this.producerTransport.produce({ track });
        this.producers.set(producer.id, producer);
        producers.push(producer);
        Logger.success(`Started producing ${track.kind}: ${producer.id}`);
      } catch (error) {
        Logger.error(`Failed to produce ${track.kind}:`, error);
      }
    }

    return producers;
  }

  // Produce media with stream association
  async produceWithStream(stream, streamId) {
    if (!this.producerTransport) {
      await this.createProducerTransport();
    }

    // Store the current stream ID for the transport's produce event handler
    this.currentStreamId = streamId;

    const producers = [];

    for (const track of stream.getTracks()) {
      try {
        let producer;
        
        if (this.device.mock) {
          // Use mock transport method
          producer = await this.producerTransport.produceWithStream({ track, streamId });
        } else {
          // For real MediaSoup transport, create the producer
          // The transport's 'produce' event handler will include the streamId
          producer = await this.producerTransport.produce({ track });
        }
        
        this.producers.set(producer.id, producer);
        producers.push(producer);
        Logger.success(`Started producing ${track.kind}: ${producer.id} (stream: ${streamId})`);
      } catch (error) {
        Logger.error(`Failed to produce ${track.kind}:`, error);
      }
    }

    return producers;
  }

  // Consume media
  async consume(producerId) {
    if (!this.consumerTransport) {
      await this.createConsumerTransport();
    }

    try {
      Logger.info(`📥 [CONSUME] Requesting consumer for producer ${producerId}`);
      Logger.info(`  🏠 SFU Node: ${this.selectedSfuNode.nodeId}:${this.selectedSfuNode.port}`);
      Logger.info(`  🚛 Transport ID: ${this.consumerTransport.id}`);
      Logger.info(`  🎯 RTP Capabilities: ${this.rtpCapabilities ? 'available' : 'missing'}`);
      
      const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportId: this.consumerTransport.id,
          producerId,
          rtpCapabilities: this.rtpCapabilities
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        Logger.error(`❌ [CONSUME] HTTP ${response.status}: ${response.statusText}`);
        if (errorData.error) {
          Logger.error(`  💬 Server message: ${errorData.error}`);
        }
        if (errorData.availableProducers) {
          Logger.info(`  📊 Available producers: ${errorData.availableProducers.map(p => `${p.id} (${p.kind})`).join(', ')}`);
        }
        throw new Error(`Failed to create consumer: ${response.status} ${response.statusText}`);
      }

      const params = await response.json();
      Logger.success(`✅ [CONSUME] Consumer parameters received:`);
      Logger.info(`  📥 Consumer ID: ${params.id}`);
      Logger.info(`  📤 Producer ID: ${params.producerId}`);
      Logger.info(`  🎬 Kind: ${params.kind}`);
      
      let consumer;
      if (this.device.mock) {
        Logger.info(`🎭 [CONSUME] Creating mock consumer`);
        consumer = new MockConsumer(params);
      } else {
        Logger.info(`🎬 [CONSUME] Creating real MediaSoup consumer`);
        consumer = await this.consumerTransport.consume(params);
      }

      this.consumers.set(consumer.id, consumer);
      Logger.success(`✅ [CONSUME] Consumer created and stored: ${consumer.id}`);

      // Resume consumer
      Logger.info(`▶️  [CONSUME] Resuming consumer ${consumer.id}...`);
      const resumeResponse = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/resume-consumer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumerId: consumer.id })
      });

      if (resumeResponse.ok) {
        Logger.success(`✅ [CONSUME] Consumer resumed: ${consumer.id}`);
      } else {
        Logger.warning(`⚠️  [CONSUME] Failed to resume consumer: ${consumer.id}`);
      }

      return consumer;
    } catch (error) {
      Logger.error(`❌ [CONSUME] Failed to consume producer ${producerId}:`, error);
      throw error;
    }
  }

  // Consume entire stream (both audio and video)
  async consumeStream(streamId) {
    if (!this.consumerTransport) {
      await this.createConsumerTransport();
    }

    try {
      Logger.info(`📺 [STREAM CONSUME] Requesting stream consumption for ${streamId}`);
      
      const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/consume-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportId: this.consumerTransport.id,
          streamId: streamId,
          rtpCapabilities: this.rtpCapabilities
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        Logger.error(`❌ [STREAM CONSUME] HTTP ${response.status}: ${response.statusText}`);
        throw new Error(`Failed to consume stream: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      Logger.success(`✅ [STREAM CONSUME] Stream consumption successful:`);
      Logger.info(`  📺 Stream: ${result.streamName}`);
      Logger.info(`  📥 Consumers: ${result.consumers.length}`);
      
      const consumers = [];
      
      // Process each consumer
      for (const consumerData of result.consumers) {
        let consumer;
        if (this.device.mock) {
          Logger.info(`🎭 [STREAM CONSUME] Creating mock consumer for ${consumerData.kind}`);
          consumer = new MockConsumer(consumerData);
        } else {
          Logger.info(`🎬 [STREAM CONSUME] Creating real MediaSoup consumer for ${consumerData.kind}`);
          consumer = await this.consumerTransport.consume(consumerData);
        }

        this.consumers.set(consumer.id, consumer);
        consumers.push(consumer);
        
        // Resume consumer
        const resumeResponse = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/resume-consumer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consumerId: consumer.id })
        });

        if (resumeResponse.ok) {
          Logger.success(`✅ [STREAM CONSUME] Consumer resumed: ${consumer.id} (${consumerData.kind})`);
        }
      }

      return {
        streamId: streamId,
        streamName: result.streamName,
        consumers: consumers
      };
      
    } catch (error) {
      Logger.error('Error consuming stream:', error);
      throw error;
    }
  }

  // Get available streams from all nodes
  async getAvailableStreams() {
    try {
      const allStreams = new Map();
      const nodes = ['sfu1', 'sfu2', 'sfu3'];
      const ports = [3001, 3002, 3003];

      Logger.info('🔍 Discovering streams across all SFU nodes...');

      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i];
        const port = ports[i];
        
        try {
          const response = await fetch(`http://localhost:${port}/api/streams`, {
            timeout: 2000
          });
          
          if (response.ok) {
            const nodeStreams = await response.json();
            Logger.info(`📡 Node ${nodeId}: Found ${nodeStreams.length} streams`);
            
            // Add node information to each stream
            nodeStreams.forEach(stream => {
              const streamKey = `${stream.id}_${nodeId}`;
              allStreams.set(streamKey, {
                ...stream,
                nodeId,
                nodeHost: 'localhost',
                nodePort: port,
                isOriginal: stream.nodeId === nodeId || !stream.nodeId, // True if this is the original node
                isPiped: stream.nodeId && stream.nodeId !== nodeId // True if this is a piped stream
              });
            });
          } else {
            Logger.warning(`⚠️ Node ${nodeId} returned ${response.status}`);
          }
        } catch (error) {
          Logger.warning(`❌ Failed to fetch streams from ${nodeId}: ${error.message}`);
        }
      }

      const streamsArray = Array.from(allStreams.values());
      Logger.success(`✅ Total streams discovered: ${streamsArray.length}`);
      
      return streamsArray;
    } catch (error) {
      Logger.error('Error discovering streams across nodes:', error);
      return [];
    }
  }

  // Get stream availability across nodes (shows which nodes have which streams)
  async getStreamAvailability() {
    try {
      const streamAvailability = new Map(); // streamId -> [nodeInfo...]
      const nodes = ['sfu1', 'sfu2', 'sfu3'];
      const ports = [3001, 3002, 3003];

      Logger.info('🌐 Checking stream availability across mesh...');

      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i];
        const port = ports[i];
        
        try {
          const response = await fetch(`http://localhost:${port}/api/streams`, {
            timeout: 2000
          });
          
          if (response.ok) {
            const nodeStreams = await response.json();
            
            nodeStreams.forEach(stream => {
              if (!streamAvailability.has(stream.id)) {
                streamAvailability.set(stream.id, []);
              }
              
              streamAvailability.get(stream.id).push({
                nodeId,
                nodeHost: 'localhost',
                nodePort: port,
                streamName: stream.name,
                isOriginal: stream.nodeId === nodeId || !stream.nodeId,
                isPiped: stream.nodeId && stream.nodeId !== nodeId,
                producers: stream.producers || [],
                status: 'available'
              });
            });
          } else {
            Logger.warning(`⚠️ Node ${nodeId} not responding (${response.status})`);
          }
        } catch (error) {
          Logger.warning(`❌ Node ${nodeId} offline: ${error.message}`);
        }
      }

      // Convert to array format with stream info
      const availability = Array.from(streamAvailability.entries()).map(([streamId, nodeInfos]) => ({
        streamId,
        streamName: nodeInfos[0]?.streamName || streamId,
        availableNodes: nodeInfos,
        totalNodes: nodeInfos.length,
        originalNode: nodeInfos.find(n => n.isOriginal)?.nodeId || nodeInfos[0]?.nodeId,
        pipedNodes: nodeInfos.filter(n => n.isPiped).map(n => n.nodeId)
      }));

      Logger.success(`✅ Stream availability check complete: ${availability.length} streams found`);
      return availability;
    } catch (error) {
      Logger.error('Error checking stream availability:', error);
      return [];
    }
  }

  // Consume from a specific node
  async consumeFromNode(streamId, nodeId) {
    try {
      const nodePort = this.getNodePort(nodeId);
      if (!nodePort) {
        throw new Error(`Unknown node: ${nodeId}`);
      }

      Logger.info(`🎯 Consuming stream ${streamId} from specific node ${nodeId}:${nodePort}`);

      // Temporarily switch to the target node
      const originalNode = this.selectedSfuNode;
      this.selectedSfuNode = {
        nodeId,
        host: 'localhost',
        port: nodePort,
        connections: 0
      };

      // Create consumer transport if needed for this node
      if (!this.consumerTransport || this.consumerTransport.nodeId !== nodeId) {
        Logger.info(`🚛 Creating consumer transport for node ${nodeId}`);
        this.consumerTransport = await this.createTransport('consumer');
        this.consumerTransport.nodeId = nodeId; // Tag transport with node ID
      }

      // Consume the stream
      const result = await this.consumeStream(streamId);
      
      // Add node information to the result
      result.consumedFromNode = nodeId;
      result.nodePort = nodePort;
      
      Logger.success(`✅ Successfully consumed stream ${streamId} from node ${nodeId}`);
      
      // Don't restore original node - keep it for future operations
      return result;
    } catch (error) {
      Logger.error(`❌ Failed to consume stream ${streamId} from node ${nodeId}:`, error);
      throw error;
    }
  }

  // Get node port mapping
  getNodePort(nodeId) {
    const nodePortMap = {
      'sfu1': 3001,
      'sfu2': 3002,
      'sfu3': 3003
    };
    return nodePortMap[nodeId];
  }

  // Get router RTP capabilities
  async getRtpCapabilities() {
    if (!this.selectedSfuNode) {
      throw new Error('No SFU node selected');
    }

    const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/router-rtp-capabilities`);
    if (!response.ok) {
      throw new Error('Failed to get RTP capabilities');
    }

    this.rtpCapabilities = await response.json();
    Logger.info('Retrieved RTP capabilities');
    return this.rtpCapabilities;
  }

  // Create device
  async createDevice() {
    try {
      // Check if mediasoup-client is available
      if (typeof window !== 'undefined' && window.mediasoupClient) {
        Logger.info('Real mediasoup-client detected, creating real device');
        this.device = new window.mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
        Logger.info('✅ Created real MediaSoup device');
        return this.device;
      } else if (typeof mediasoupClient !== 'undefined') {
        Logger.info('mediasoupClient global detected, creating real device');
        this.device = new mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
        Logger.info('✅ Created real MediaSoup device');
        return this.device;
      } else {
        Logger.warning('⚠️ Real mediasoup-client not available, checking for fallback...');
        throw new Error('MediaSoup client not loaded');
      }
    } catch (error) {
      Logger.warning('❌ Failed to create real device, using mock:', error.message);
      this.device = new MockMediaSoupDevice(this.rtpCapabilities);
      Logger.info('🎭 Created mock MediaSoup device');
      return this.device;
    }
  }

  // Create WebRTC transport
  async createTransport(type) {
    const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/create-transport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to create transport');
    }

    const params = await response.json();
    Logger.info(`Created ${type} transport: ${params.id}`);

    let transport;
    if (this.device.mock) {
      transport = new MockTransport(params, type, this);
    } else {
      if (type === 'producer') {
        transport = this.device.createSendTransport(params);
      } else {
        transport = this.device.createRecvTransport(params);
      }
    }

    // Connect transport
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        // Debug DTLS parameters
        console.log(`🔐 [CLIENT] Connecting ${type} transport with DTLS parameters:`, dtlsParameters);
        
        if (!dtlsParameters || !dtlsParameters.fingerprints || dtlsParameters.fingerprints.length === 0) {
          console.error(`❌ [CLIENT] Invalid DTLS parameters for ${type} transport:`, dtlsParameters);
          throw new Error(`Invalid DTLS parameters for ${type} transport - empty fingerprints`);
        }
        
        console.log(`🔐 [CLIENT] DTLS fingerprints (${dtlsParameters.fingerprints.length}):`, 
                    dtlsParameters.fingerprints.map(fp => `${fp.algorithm}:${fp.value}`));
        
        const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/connect-transport`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transportId: params.id,
            dtlsParameters
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to connect transport: ${response.status} ${errorText}`);
        }

        Logger.info(`Connected ${type} transport`);
        callback();
      } catch (error) {
        Logger.error(`Failed to connect ${type} transport:`, error);
        errback(error);
      }
    });

    return transport;
  }

  // Create producer transport
  async createProducerTransport() {
    this.producerTransport = await this.createTransport('producer');
    
    // Add produce event handler for real transports
    this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/produce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transportId: this.producerTransport.id,
            kind,
            rtpParameters,
            streamId: this.currentStreamId // Include stream ID if available
          })
        });

        if (!response.ok) {
          throw new Error('Failed to create producer');
        }

        const { id } = await response.json();
        Logger.success(`Created producer: ${id} (${kind})`);
        callback({ id });
      } catch (error) {
        Logger.error('Failed to create producer:', error);
        errback(error);
      }
    });

    return this.producerTransport;
  }

  // Create consumer transport
  async createConsumerTransport() {
    this.consumerTransport = await this.createTransport('consumer');
    return this.consumerTransport;
  }

  // Produce media
  async produce(stream) {
    if (!this.producerTransport) {
      await this.createProducerTransport();
    }

    const producers = [];

    for (const track of stream.getTracks()) {
      try {
        const producer = await this.producerTransport.produce({ track });
        this.producers.set(producer.id, producer);
        producers.push(producer);
        Logger.success(`Started producing ${track.kind}: ${producer.id}`);
      } catch (error) {
        Logger.error(`Failed to produce ${track.kind}:`, error);
      }
    }

    return producers;
  }

  // Produce media with stream association
  async produceWithStream(stream, streamId) {
    if (!this.producerTransport) {
      await this.createProducerTransport();
    }

    // Store the current stream ID for the transport's produce event handler
    this.currentStreamId = streamId;

    const producers = [];

    for (const track of stream.getTracks()) {
      try {
        let producer;
        
        if (this.device.mock) {
          // Use mock transport method
          producer = await this.producerTransport.produceWithStream({ track, streamId });
        } else {
          // For real MediaSoup transport, create the producer
          // The transport's 'produce' event handler will include the streamId
          producer = await this.producerTransport.produce({ track });
        }
        
        this.producers.set(producer.id, producer);
        producers.push(producer);
        Logger.success(`Started producing ${track.kind}: ${producer.id} (stream: ${streamId})`);
      } catch (error) {
        Logger.error(`Failed to produce ${track.kind}:`, error);
      }
    }

    return producers;
  }

  // Consume media
  async consume(producerId) {
    if (!this.consumerTransport) {
      await this.createConsumerTransport();
    }

    try {
      Logger.info(`📥 [CONSUME] Requesting consumer for producer ${producerId}`);
      Logger.info(`  🏠 SFU Node: ${this.selectedSfuNode.nodeId}:${this.selectedSfuNode.port}`);
      Logger.info(`  🚛 Transport ID: ${this.consumerTransport.id}`);
      Logger.info(`  🎯 RTP Capabilities: ${this.rtpCapabilities ? 'available' : 'missing'}`);
      
      const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportId: this.consumerTransport.id,
          producerId,
          rtpCapabilities: this.rtpCapabilities
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        Logger.error(`❌ [CONSUME] HTTP ${response.status}: ${response.statusText}`);
        if (errorData.error) {
          Logger.error(`  💬 Server message: ${errorData.error}`);
        }
        if (errorData.availableProducers) {
          Logger.info(`  📊 Available producers: ${errorData.availableProducers.map(p => `${p.id} (${p.kind})`).join(', ')}`);
        }
        throw new Error(`Failed to create consumer: ${response.status} ${response.statusText}`);
      }

      const params = await response.json();
      Logger.success(`✅ [CONSUME] Consumer parameters received:`);
      Logger.info(`  📥 Consumer ID: ${params.id}`);
      Logger.info(`  📤 Producer ID: ${params.producerId}`);
      Logger.info(`  🎬 Kind: ${params.kind}`);
      
      let consumer;
      if (this.device.mock) {
        Logger.info(`🎭 [CONSUME] Creating mock consumer`);
        consumer = new MockConsumer(params);
      } else {
        Logger.info(`🎬 [CONSUME] Creating real MediaSoup consumer`);
        consumer = await this.consumerTransport.consume(params);
      }

      this.consumers.set(consumer.id, consumer);
      Logger.success(`✅ [CONSUME] Consumer created and stored: ${consumer.id}`);

      // Resume consumer
      Logger.info(`▶️  [CONSUME] Resuming consumer ${consumer.id}...`);
      const resumeResponse = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/resume-consumer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumerId: consumer.id })
      });

      if (resumeResponse.ok) {
        Logger.success(`✅ [CONSUME] Consumer resumed: ${consumer.id}`);
      } else {
        Logger.warning(`⚠️  [CONSUME] Failed to resume consumer: ${consumer.id}`);
      }

      return consumer;
    } catch (error) {
      Logger.error(`❌ [CONSUME] Failed to consume producer ${producerId}:`, error);
      throw error;
    }
  }

  // Consume entire stream (both audio and video)
  async consumeStream(streamId) {
    if (!this.consumerTransport) {
      await this.createConsumerTransport();
    }

    try {
      Logger.info(`📺 [STREAM CONSUME] Requesting stream consumption for ${streamId}`);
      
      const response = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/consume-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportId: this.consumerTransport.id,
          streamId: streamId,
          rtpCapabilities: this.rtpCapabilities
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        Logger.error(`❌ [STREAM CONSUME] HTTP ${response.status}: ${response.statusText}`);
        throw new Error(`Failed to consume stream: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      Logger.success(`✅ [STREAM CONSUME] Stream consumption successful:`);
      Logger.info(`  📺 Stream: ${result.streamName}`);
      Logger.info(`  📥 Consumers: ${result.consumers.length}`);
      
      const consumers = [];
      
      // Process each consumer
      for (const consumerData of result.consumers) {
        let consumer;
        if (this.device.mock) {
          Logger.info(`🎭 [STREAM CONSUME] Creating mock consumer for ${consumerData.kind}`);
          consumer = new MockConsumer(consumerData);
        } else {
          Logger.info(`🎬 [STREAM CONSUME] Creating real MediaSoup consumer for ${consumerData.kind}`);
          consumer = await this.consumerTransport.consume(consumerData);
        }

        this.consumers.set(consumer.id, consumer);
        consumers.push(consumer);
        
        // Resume consumer
        const resumeResponse = await fetch(`http://localhost:${this.selectedSfuNode.port}/api/resume-consumer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consumerId: consumer.id })
        });

        if (resumeResponse.ok) {
          Logger.success(`✅ [STREAM CONSUME] Consumer resumed: ${consumer.id} (${consumerData.kind})`);
        }
      }

      return {
        streamId: streamId,
        streamName: result.streamName,
        consumers: consumers
      };
      
    } catch (error) {
      Logger.error('Error consuming stream:', error);
      throw error;
    }
  }

  // Get available streams from all nodes
  async getAvailableStreams() {
    try {
      const allStreams = new Map();
      const nodes = ['sfu1', 'sfu2', 'sfu3'];
      const ports = [3001, 3002, 3003];

      Logger.info('🔍 Discovering streams across all SFU nodes...');

      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i];
        const port = ports[i];
        
        try {
          const response = await fetch(`http://localhost:${port}/api/streams`, {
            timeout: 2000
          });
          
          if (response.ok) {
            const nodeStreams = await response.json();
            Logger.info(`📡 Node ${nodeId}: Found ${nodeStreams.length} streams`);
            
            // Add node information to each stream
            nodeStreams.forEach(stream => {
              const streamKey = `${stream.id}_${nodeId}`;
              allStreams.set(streamKey, {
                ...stream,
                nodeId,
                nodeHost: 'localhost',
                nodePort: port,
                isOriginal: stream.nodeId === nodeId || !stream.nodeId, // True if this is the original node
                isPiped: stream.nodeId && stream.nodeId !== nodeId // True if this is a piped stream
              });
            });
          } else {
            Logger.warning(`⚠️ Node ${nodeId} returned ${response.status}`);
          }
        } catch (error) {
          Logger.warning(`❌ Failed to fetch streams from ${nodeId}: ${error.message}`);
        }
      }

      const streamsArray = Array.from(allStreams.values());
      Logger.success(`✅ Total streams discovered: ${streamsArray.length}`);
      
      return streamsArray;
    } catch (error) {
      Logger.error('Error discovering streams across nodes:', error);
      return [];
    }
  }

  // Get stream availability across nodes (shows which nodes have which streams)
  async getStreamAvailability() {
    try {
      const streamAvailability = new Map(); // streamId -> [nodeInfo...]
      const nodes = ['sfu1', 'sfu2', 'sfu3'];
      const ports = [3001, 3002, 3003];

      Logger.info('🌐 Checking stream availability across mesh...');

      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i];
        const port = ports[i];
        
        try {
          const response = await fetch(`http://localhost:${port}/api/streams`, {
            timeout: 2000
          });
          
          if (response.ok) {
            const nodeStreams = await response.json();
            
            nodeStreams.forEach(stream => {
              if (!streamAvailability.has(stream.id)) {
                streamAvailability.set(stream.id, []);
              }
              
              streamAvailability.get(stream.id).push({
                nodeId,
                nodeHost: 'localhost',
                nodePort: port,
                streamName: stream.name,
                isOriginal: stream.nodeId === nodeId || !stream.nodeId,
                isPiped: stream.nodeId && stream.nodeId !== nodeId,
                producers: stream.producers || [],
                status: 'available'
              });
            });
          } else {
            Logger.warning(`⚠️ Node ${nodeId} not responding (${response.status})`);
          }
        } catch (error) {
          Logger.warning(`❌ Node ${nodeId} offline: ${error.message}`);
        }
      }

      // Convert to array format with stream info
      const availability = Array.from(streamAvailability.entries()).map(([streamId, nodeInfos]) => ({
        streamId,
        streamName: nodeInfos[0]?.streamName || streamId,
        availableNodes: nodeInfos,
        totalNodes: nodeInfos.length,
        originalNode: nodeInfos.find(n => n.isOriginal)?.nodeId || nodeInfos[0]?.nodeId,
        pipedNodes: nodeInfos.filter(n => n.isPiped).map(n => n.nodeId)
      }));

      Logger.success(`✅ Stream availability check complete: ${availability.length} streams found`);
      return availability;
    } catch (error) {
      Logger.error('Error checking stream availability:', error);
      return [];
    }
  }

  // Consume from a specific node
  async consumeFromNode(streamId, nodeId) {
    try {
      const nodePort = this.getNodePort(nodeId);
      if (!nodePort) {
        throw new Error(`Unknown node: ${nodeId}`);
      }

      Logger.info(`🎯 Consuming stream ${streamId} from specific node ${nodeId}:${nodePort}`);

      // Temporarily switch to the target node
      const originalNode = this.selectedSfuNode;
      this.selectedSfuNode = {
        nodeId,
        host: 'localhost',
        port: nodePort,
        connections: 0
      };

      // Create consumer transport if needed for this node
      if (!this.consumerTransport || this.consumerTransport.nodeId !== nodeId) {
        Logger.info(`🚛 Creating consumer transport for node ${nodeId}`);
        this.consumerTransport = await this.createTransport('consumer');
        this.consumerTransport.nodeId = nodeId; // Tag transport with node ID
      }

      // Consume the stream
      const result = await this.consumeStream(streamId);
      
      // Add node information to the result
      result.consumedFromNode = nodeId;
      result.nodePort = nodePort;
      
      Logger.success(`✅ Successfully consumed stream ${streamId} from node ${nodeId}`);
      
      // Don't restore original node - keep it for future operations
      return result;
    } catch (error) {
      Logger.error(`❌ Failed to consume stream ${streamId} from node ${nodeId}:`, error);
      throw error;
    }
  }

  // Get node port mapping
  getNodePort(nodeId) {
    const nodePortMap = {
      'sfu1': 3001,
      'sfu2': 3002,
      'sfu3': 3003
    };
    return nodePortMap[nodeId];
  }
}

// Mock MediaSoup Device for testing
class MockMediaSoupDevice {
  constructor(rtpCapabilities) {
    this.rtpCapabilities = rtpCapabilities;
    this.mock = true;
    this.loaded = true;
  }

  createSendTransport(params) {
    return new MockTransport(params, 'send');
  }

  createRecvTransport(params) {
    return new MockTransport(params, 'recv');
  }
}

// Mock Transport
class MockTransport {
  constructor(params, type, client) {
    this.id = params.id;
    this.type = type;
    this.client = client;
    this.eventHandlers = new Map();
    this.mock = true;
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data, callback, errback) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data, callback, errback);
        } catch (error) {
          if (errback) errback(error);
        }
      });
    }
  }

  async produce({ track }) {
    // Simulate producer creation with proper RTP parameters
    const producer = new MockProducer(track);
    
    // Generate basic RTP parameters based on track kind
    const rtpParameters = this.generateRtpParameters(track.kind);
    
    try {
      // Make HTTP request to SFU server to create producer
      const response = await fetch(`http://localhost:${this.client.selectedSfuNode.port}/api/produce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportId: this.id,
          kind: track.kind,
          rtpParameters: rtpParameters
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create producer: ${response.status}`);
      }

      const result = await response.json();
      producer.id = result.id;
      
      Logger.success(`Mock producer created with ID: ${producer.id}`);
      
    } catch (error) {
      // Fallback to local ID generation
      producer.id = `mock_producer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      Logger.warning(`Failed to create server-side producer, using local ID: ${producer.id}`);
    }

    return producer;
  }

  async produceWithStream({ track, streamId }) {
    // Simulate producer creation with stream association
    const producer = new MockProducer(track);
    
    // Generate basic RTP parameters based on track kind
    const rtpParameters = this.generateRtpParameters(track.kind);
    
    try {
      // Make HTTP request to SFU server to create producer with stream association
      const response = await fetch(`http://localhost:${this.client.selectedSfuNode.port}/api/produce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportId: this.id,
          kind: track.kind,
          rtpParameters: rtpParameters,
          streamId: streamId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create producer: ${response.status}`);
      }

      const result = await response.json();
      producer.id = result.id;
      producer.streamId = result.streamId;
      
      Logger.success(`Mock producer created with ID: ${producer.id} (stream: ${streamId})`);
      
    } catch (error) {
      // Fallback to local ID generation
      producer.id = `mock_producer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      producer.streamId = streamId;
      Logger.warning(`Failed to create server-side producer, using local ID: ${producer.id}`);
    }

    return producer;
  }

  generateRtpParameters(kind) {
    if (kind === 'video') {
      return {
        codecs: [{
          mimeType: 'video/VP8',
          payloadType: 96,
          clockRate: 90000,
          parameters: {},
          rtcpFeedback: [
            { type: 'nack' },
            { type: 'nack', parameter: 'pli' },
            { type: 'ccm', parameter: 'fir' }
          ]
        }],
        encodings: [{
          ssrc: Math.floor(Math.random() * 1000000000) + 1000000000,
          maxBitrate: 1000000
        }],
        headerExtensions: [
          { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 1 },
          { uri: 'urn:3gpp:video-orientation', id: 2 }
        ]
      };
    } else if (kind === 'audio') {
      return {
        codecs: [{
          mimeType: 'audio/opus',
          payloadType: 111,
          clockRate: 48000,
          channels: 2,
          parameters: {},
          rtcpFeedback: []
        }],
        encodings: [{
          ssrc: Math.floor(Math.random() * 1000000000) + 1000000000,
          maxBitrate: 128000
        }],
        headerExtensions: [
          { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 1 }
        ]
      };
    }
    
    return {
      codecs: [],
      encodings: [],
      headerExtensions: []
    };
  }

  async consume(params) {
    return new MockConsumer(params);
  }
}

// Mock Producer
class MockProducer {
  constructor(track) {
    this.track = track;
    this.kind = track.kind;
    this.id = null;
    this.streamId = null;
    this.mock = true;
  }

  close() {
    Logger.info(`Mock producer closed: ${this.id}`);
  }
}

// Mock Consumer
class MockConsumer {
  constructor(params) {
    this.id = params.id;
    this.kind = params.kind;
    this.producerId = params.producerId;
    this.mock = true;
    
    // Create a mock track for video
    if (params.kind === 'video') {
      this.track = this.createMockVideoTrack();
    } else {
      this.track = this.createMockAudioTrack();
    }
  }

  createMockVideoTrack() {
    // Create a canvas for animated mock video
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    // Animate the canvas
    let frame = 0;
    const animate = () => {
      ctx.fillStyle = `hsl(${frame % 360}, 70%, 50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = 'white';
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('MOCK STREAM', canvas.width / 2, canvas.height / 2);
      ctx.fillText(`Frame ${frame}`, canvas.width / 2, canvas.height / 2 + 60);
      
      frame++;
      requestAnimationFrame(animate);
    };
    animate();

    return canvas.captureStream(30).getVideoTracks()[0];
  }

  createMockAudioTrack() {
    // Create silent audio track
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const destination = audioContext.createMediaStreamDestination();
    
    oscillator.connect(destination);
    oscillator.frequency.setValueAtTime(0, audioContext.currentTime);
    oscillator.start();
    
    return destination.stream.getAudioTracks()[0];
  }

  close() {
    Logger.info(`Mock consumer closed: ${this.id}`);
    if (this.track) {
      this.track.stop();
    }
  }
}

// Logger utility
class Logger {
  static log(level, message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    // Console logging
    const consoleMethod = level === 'error' ? 'error' : 
                         level === 'warning' ? 'warn' : 'log';
    console[consoleMethod](`[${timestamp}] ${message}`, data || '');

    // Emit to UI
    if (window.addLogEntry) {
      window.addLogEntry(logEntry);
    }

    return logEntry;
  }

  static info(message, data) {
    return this.log('info', message, data);
  }

  static success(message, data) {
    return this.log('success', message, data);
  }

  static warning(message, data) {
    return this.log('warning', message, data);
  }

  static error(message, data) {
    return this.log('error', message, data);
  }
}

// Notification utility
class Notifications {
  static show(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, duration);
  }

  static success(message) {
    this.show(message, 'success');
  }

  static error(message) {
    this.show(message, 'error');
  }

  static info(message) {
    this.show(message, 'info');
  }
}

// Status monitoring
class StatusMonitor {
  constructor() {
    this.sfuNodes = new Map();
    this.updateInterval = null;
  }

  start() {
    this.updateInterval = setInterval(() => {
      this.updateNodeStatus();
    }, 5000);
    
    // Initial update
    this.updateNodeStatus();
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  async updateNodeStatus() {
    const nodes = ['sfu1', 'sfu2', 'sfu3'];
    const ports = [3001, 3002, 3003];

    for (let i = 0; i < nodes.length; i++) {
      const nodeId = nodes[i];
      const port = ports[i];

      try {
        const response = await fetch(`http://localhost:${port}/api/stats`, {
          timeout: 2000
        });
        
        if (response.ok) {
          const stats = await response.json();
          this.sfuNodes.set(nodeId, {
            ...stats,
            online: true,
            lastSeen: Date.now()
          });
        } else {
          this.sfuNodes.set(nodeId, {
            nodeId,
            online: false,
            lastSeen: Date.now()
          });
        }
      } catch (error) {
        this.sfuNodes.set(nodeId, {
          nodeId,
          online: false,
          lastSeen: Date.now(),
          error: error.message
        });
      }
    }

    // Update UI
    if (window.updateNodeStatus) {
      window.updateNodeStatus(Array.from(this.sfuNodes.values()));
    }
  }

  getNodeStatus(nodeId) {
    return this.sfuNodes.get(nodeId) || { nodeId, online: false };
  }

  getAllNodes() {
    return Array.from(this.sfuNodes.values());
  }
}

// Global instances
window.MediaSoupClient = MediaSoupClient;
window.Logger = Logger;
window.Notifications = Notifications;
window.StatusMonitor = StatusMonitor;

// Debug functions to prevent errors
window.forceShowPlayButtons = function() {
  console.log('=== Force Show Play Buttons ===');
  const videos = document.querySelectorAll('video');
  videos.forEach((video, index) => {
    video.controls = true;
    console.log(`Video ${index + 1}: controls enabled`);
  });
  console.log('====================');
};

window.checkTransports = function() {
  console.log('=== Transport Debug Info ===');
  console.log('MediaSoup client available:', !!window.MediaSoupClient);
  console.log('Socket.IO available:', !!window.io);
  
  if (window.viewerApp) {
    console.log('Viewer app:', {
      isConnected: window.viewerApp.isConnected,
      isInRoom: window.viewerApp.isInRoom,
      isWatching: window.viewerApp.isWatching,
      consumers: window.viewerApp.consumers ? window.viewerApp.consumers.size : 0,
      socket: !!window.viewerApp.socket
    });
  }
  
  if (window.streamerApp || window.app) {
    const app = window.streamerApp || window.app;
    console.log('Streamer app:', {
      isConnected: app.isConnected,
      isInRoom: app.isInRoom,
      isStreaming: app.isStreaming,
      producers: app.producers ? app.producers.size : 0,
      socket: !!app.socket
    });
  }
  
  console.log('====================');
};
