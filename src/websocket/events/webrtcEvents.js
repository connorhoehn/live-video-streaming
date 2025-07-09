// WebRTC-related WebSocket events
const { makeHttpRequest } = require('../../utils/http'); // Use existing HTTP utility

module.exports = (transportManager, roomManager, routerManager, router, peerManager, dependencies) => {
  return {
    'get-router-capabilities': (socket, { roomId }, callback) => {
      try {
        // Get router capabilities for specific room or default router
        let rtpCapabilities;
        
        if (roomId) {
          const routerId = roomManager.getRoomRouterId(roomId);
          if (routerId) {
            const roomRouter = routerManager.getRouter(routerId);
            rtpCapabilities = roomRouter ? roomRouter.rtpCapabilities : router.rtpCapabilities;
          } else {
            rtpCapabilities = router.rtpCapabilities;
          }
        } else {
          rtpCapabilities = router.rtpCapabilities;
        }
        
        callback({ rtpCapabilities });
      } catch (error) {
        console.error(`❌ Error getting router capabilities:`, error);
        callback({ error: error.message });
      }
    },

    'create-transport': async (socket, { type, roomId, participantId }, callback) => {
      try {
        const transport = type === 'producer' ?
          await transportManager.createProducerTransport() :
          await transportManager.createConsumerTransport();
        
        // Associate with peer
        peerManager.addTransportToPeer(socket.id, transport.id);
        
        // Associate with room participant if specified
        if (roomId && participantId) {
          const transportType = type === 'producer' ? 'producer' : 'consumer';
          await roomManager.addTransportToParticipant(roomId, participantId, transport.id, transportType);
        }
        
        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        });
      } catch (error) {
        console.error(`❌ Error creating ${type} transport:`, error);
        callback({ error: error.message });
      }
    },

    'connect-transport': async (socket, { transportId, dtlsParameters }, callback) => {
      try {
        console.log('🔗 [TRANSPORT] Connecting transport:', transportId);
        console.log('🔗 [TRANSPORT] DTLS parameters:', dtlsParameters);
        await transportManager.connectTransport(transportId, dtlsParameters);
        callback({ success: true });
      } catch (error) {
        console.error(`❌ Error connecting transport:`, error);
        callback({ error: error.message });
      }
    },

    'produce': async (socket, { transportId, kind, rtpParameters, roomId, participantId }, callback) => {
      try {
        const producer = await transportManager.createProducer(transportId, { kind, rtpParameters });
        
        // Associate with peer
        peerManager.addProducerToPeer(socket.id, producer.id);
        
        // Add producer to room if specified
        if (roomId && participantId) {
          await roomManager.addProducerToParticipant(roomId, participantId, producer.id, { kind });
          
          // Notify other room participants
          socket.to(`room:${roomId}`).emit('new-producer', {
            producerId: producer.id,
            participantId,
            kind
          });
          
          // **NEW: Trigger mesh/fan-out**
          console.log(`🌐 [MESH] Triggering fan-out for producer ${producer.id} via WebSocket`);
          performMeshFanOut(producer.id, roomId, participantId, kind, dependencies, transportManager, routerManager).catch(error => {
            console.error(`❌ [MESH] Fan-out failed for producer ${producer.id}:`, error);
          });
        }
        
        callback({ id: producer.id });
      } catch (error) {
        console.error(`❌ Error producing:`, error);
        callback({ error: error.message });
      }
    },

    'consume': async (socket, { transportId, producerId, rtpCapabilities, roomId, participantId }, callback) => {
      try {
        if (!transportManager.canConsume(transportId, { producerId, rtpCapabilities })) {
          throw new Error('Cannot consume with given rtpCapabilities');
        }
        
        const consumer = await transportManager.createConsumer(transportId, { 
          producerId,
          rtpCapabilities,
          paused: true // Start paused
        });
        
        // Associate with peer
        peerManager.addConsumerToPeer(socket.id, consumer.id);
        
        // Add consumer to room if specified
        if (roomId && participantId) {
          await roomManager.addConsumerToParticipant(roomId, participantId, consumer.id, {
            producerId,
            kind: consumer.kind
          });
        }
        
        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused
        });
      } catch (error) {
        console.error(`❌ Error consuming:`, error);
        callback({ error: error.message });
      }
    },

    'get-producers': async (socket, data) => {
      try {
        // Handle case where data might be undefined
        if (!data) {
          console.warn('⚠️ get-producers called without data');
          socket.emit('producers', { roomId: null, producers: [] });
          return;
        }
        
        const { roomId, participantId } = data;
        
        if (!roomId) {
          console.warn('⚠️ get-producers called without roomId');
          socket.emit('producers', { roomId: null, producers: [] });
          return;
        }
        
        const producers = await roomManager.getRoomProducers(roomId);
        const filteredProducers = producers.filter(p => p.participantId !== participantId);
        
        socket.emit('producers', {
          roomId,
          producers: filteredProducers.map(p => ({
            id: p.id,
            participantId: p.participantId,
            kind: p.kind,
            rtpParameters: p.rtpParameters
          }))
        });
      } catch (error) {
        console.error(`❌ Error getting producers:`, error);
        socket.emit('error', { message: error.message });
      }
    },

    'producer-stats': async (socket, { producerId }, callback) => {
      try {
        const producer = transportManager.getProducer(producerId);
        if (producer) {
          const stats = await producer.getStats();
          callback({ stats });
        } else {
          callback({ error: 'Producer not found' });
        }
      } catch (error) {
        console.error(`❌ Error getting producer stats:`, error);
        callback({ error: error.message });
      }
    },

    'consumer-stats': async (socket, { consumerId }, callback) => {
      try {
        const consumer = transportManager.getConsumer(consumerId);
        if (consumer) {
          const stats = await consumer.getStats();
          callback({ stats });
        } else {
          callback({ error: 'Consumer not found' });
        }
      } catch (error) {
        console.error(`❌ Error getting consumer stats:`, error);
        callback({ error: error.message });
      }
    },

    'pause-producer': async (socket, { producerId }, callback) => {
      try {
        const producer = transportManager.getProducer(producerId);
        if (producer) {
          await producer.pause();
          callback({ success: true });
        } else {
          callback({ error: 'Producer not found' });
        }
      } catch (error) {
        console.error(`❌ Error pausing producer:`, error);
        callback({ error: error.message });
      }
    },

    'resume-producer': async (socket, { producerId }, callback) => {
      try {
        const producer = transportManager.getProducer(producerId);
        if (producer) {
          await producer.resume();
          callback({ success: true });
        } else {
          callback({ error: 'Producer not found' });
        }
      } catch (error) {
        console.error(`❌ Error resuming producer:`, error);
        callback({ error: error.message });
      }
    },

    'pause-consumer': async (socket, { consumerId }, callback) => {
      try {
        const consumer = transportManager.getConsumer(consumerId);
        if (consumer) {
          await consumer.pause();
          callback({ success: true });
        } else {
          callback({ error: 'Consumer not found' });
        }
      } catch (error) {
        console.error(`❌ Error pausing consumer:`, error);
        callback({ error: error.message });
      }
    },

    'resume-consumer': async (socket, { consumerId }, callback) => {
      try {
        const consumer = transportManager.getConsumer(consumerId);
        if (consumer) {
          await consumer.resume();
          callback({ success: true });
        } else {
          callback({ error: 'Consumer not found' });
        }
      } catch (error) {
        console.error(`❌ Error resuming consumer:`, error);
        callback({ error: error.message });
      }
    }
  };
};

/**
 * Perform mesh/fan-out when a producer is created
 * This pipes the producer to other SFU nodes for mesh distribution using Redis coordination
 */
async function performMeshFanOut(producerId, roomId, participantId, kind, dependencies, transportManager, routerManager) {
  try {
    const { meshCoordinator, nodeId, redisMesh } = dependencies;
    
    if (!meshCoordinator) {
      console.log(`⚠️  [MESH] No mesh coordinator available for fan-out`);
      return;
    }

    if (!redisMesh || !redisMesh.connected) {
      console.log(`⚠️  [MESH] No Redis mesh state available for fan-out`);
      return;
    }
    
    console.log(`🌐 [MESH] Starting Redis-coordinated fan-out for producer ${producerId} (${kind}) in room ${roomId}`);
    
    // 1. Get active nodes from Redis
    const allNodes = await redisMesh.getActiveNodes();
    const targetNodes = allNodes.filter(node => node.id !== nodeId);
    
    if (targetNodes.length === 0) {
      console.log(`📡 [MESH] No other active nodes found for fan-out`);
      return;
    }
    
    console.log(`🔍 [MESH] Found ${targetNodes.length} target nodes for fan-out:`, targetNodes.map(n => n.id));
     // 2. Use existing pipe transports for each target node
    for (const targetNode of targetNodes) {
      try {
        console.log(`🔄 [MESH] Piping to node ${targetNode.id} for producer ${producerId}`);
        
        // Get existing pipe transport from Redis
        const existingPipeTransport = await redisMesh.getPipeTransport(nodeId, targetNode.id);
        if (!existingPipeTransport) {
          console.error(`❌ [MESH] No existing pipe transport found: ${nodeId} -> ${targetNode.id}`);
          continue;
        }

        console.log(`✅ [MESH] Found existing pipe transport: ${existingPipeTransport.id} (${nodeId} -> ${targetNode.id})`);
        
        // Get the local pipe transport from TransportManager
        const localPipeTransport = transportManager.getPipeTransport(existingPipeTransport.id);
        if (!localPipeTransport) {
          console.error(`❌ [MESH] Local pipe transport ${existingPipeTransport.id} not found in TransportManager`);
          continue;
        }

        // Get original producer
        const originalProducer = transportManager.getProducer(producerId);
        if (!originalProducer) {
          console.error(`❌ [MESH] Original producer ${producerId} not found`);
          continue;
        }

        // Create pipe producer using TransportManager
        const pipeProducerResult = await transportManager.createPipeProducer(existingPipeTransport.id, {
          kind: originalProducer.kind,
          rtpParameters: originalProducer.rtpParameters
        });
        
        console.log(`� [MESH] Pipe producer created: ${pipeProducerResult.id} -> ${targetNode.id}`);
        
        // Store pipe producer info in Redis
        await redisMesh.storePipeProducer({
          pipeProducerId: pipeProducerResult.id,
          originalProducerId: producerId,
          sourceNode: nodeId,
          targetNode: targetNode.id,
          transportId: existingPipeTransport.id,
          kind: kind,
          roomId: roomId,
          participantId: participantId
        });

        // Get target pipe transport info from Redis (the transport on the target node that receives from source)
        const targetPipeTransport = await redisMesh.getPipeTransport(targetNode.id, nodeId);
        if (!targetPipeTransport) {
          console.error(`❌ [MESH] No target pipe transport found: ${targetNode.id} -> ${nodeId}`);
          continue;
        }
        
        // Wait for pipe producer to be established and propagated to target router
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Prepare request payload
        const requestPayload = {
          producerId: pipeProducerResult.id,
          streamId: `${roomId}_${participantId}`,
          streamName: `${participantId}'s stream`,
          participantId: participantId,
          roomId: roomId,
          originalProducerId: originalProducer.id  // Keep track of the original producer ID
        };
        
        console.log(`🔍 [MESH] Sending pipe consume request to ${targetNode.id}:`, {
          url: `http://${targetNode.host}:${targetNode.port}/api/pipe-transports/${targetPipeTransport.id}/consume`,
          payload: requestPayload
        });
        
        // Create pipe consumer on target node using the correct transport
        const pipeConsumerResponse = await makeHttpRequest({
          hostname: targetNode.host,
          port: targetNode.port,
          path: `/api/pipe-transports/${targetPipeTransport.id}/consume`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, requestPayload);
        
        console.log(`📥 [MESH] Raw pipe consumer response from ${targetNode.id}:`, pipeConsumerResponse);
        
        console.log(`📥 [MESH] Raw pipe consumer response from ${targetNode.id}:`, pipeConsumerResponse);
        
        let pipeConsumerData;
        try {
          pipeConsumerData = JSON.parse(pipeConsumerResponse);
          console.log(`📥 [MESH] Parsed pipe consumer data from ${targetNode.id}:`, pipeConsumerData);
        } catch (parseError) {
          console.error(`❌ [MESH] Failed to parse pipe consumer response from ${targetNode.id}:`, parseError.message);
          console.error(`❌ [MESH] Raw response that failed to parse:`, pipeConsumerResponse);
          throw new Error(`Failed to parse pipe consumer response: ${parseError.message}`);
        }
        
        if (pipeConsumerData.error) {
          console.error(`❌ [MESH] Pipe consumer creation failed on ${targetNode.id}:`, pipeConsumerData.error);
          throw new Error(`Pipe consumer creation failed: ${pipeConsumerData.error}`);
        }
        
        console.log(`📥 [MESH] Pipe consumer created: ${pipeConsumerData.id} on ${targetNode.id}`);
        
        // Report pipe connection to coordinator
        await meshCoordinator.reportPipeConnection({
          sourceRouterId: localPipeTransport.transport.router?.id || 'unknown',
          targetRouterId: targetPipeTransport.routerId || 'default',
          sourceNodeId: nodeId,
          targetNodeId: targetNode.id,
          producerId: producerId,
          pipeProducerId: pipeProducerResult.id,
          pipeConsumerId: pipeConsumerData.id,
          roomId: roomId,
          participantId: participantId,
          kind: kind
        });
        
        console.log(`✅ [MESH] Successfully piped producer ${producerId} to node ${targetNode.id}`);
        
      } catch (error) {
        console.error(`❌ [MESH] Failed to pipe producer ${producerId} to node ${targetNode.id}:`, error.message);
      }
    }
    
    console.log(`🌐 [MESH] Fan-out completed for producer ${producerId}`);
    
  } catch (error) {
    console.error(`❌ [MESH] Fan-out failed for producer ${producerId}:`, error.message);
  }
}
