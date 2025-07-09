/**
 * Ensure a producer is piped to the target router using canonical Mediasoup v3 pattern
 * @param {Object} params - Parameters
 * @param {string} params.producerId - Original producer ID to pipe
 * @param {Object} params.routerManager - Router manager instance
 * @param {Object} params.targetRouter - Target router to pipe to
 * @returns {Promise<string>} The piped producer ID on the target router
 * @throws {Error} If producer not found or piping fails
 */
async function ensureProducerPipedToRouter({ producerId, routerManager, targetRouter }) {
  if (!targetRouter) {
    throw new Error('Target router is undefined');
  }

  console.log(`🔍 [PIPE] Ensuring producer ${producerId} is piped to router ${targetRouter.id}`);
  
  // First, check if producer is already piped to the target router
  // In Mediasoup, when a producer is piped, it creates a new producer on the target router
  // We need to check if there's already a piped producer for this original producer
  try {
    const targetProducers = targetRouter.getProducers();
    console.log(`🔍 [PIPE] Target router ${targetRouter.id} has ${targetProducers.length} producers`);
    
    // Check if any producer has the original producer ID in its appData
    for (const producer of targetProducers) {
      if (producer.appData && producer.appData.originalProducerId === producerId) {
        console.log(`✅ [PIPE] Producer ${producerId} already piped to router ${targetRouter.id} as ${producer.id}`);
        return producer.id;
      }
    }
  } catch (error) {
    console.warn(`⚠️ [PIPE] Error checking target router producers: ${error.message}`);
  }

  // Search for the original producer on local routers
  const localRouters = Array.from(routerManager.routers.values()).map(routerInfo => routerInfo.router);
  let sourceRouter = null;
  let originalProducer = null;
  
  console.log(`🔍 [PIPE] Searching ${localRouters.length} local routers for producer ${producerId}`);
  
  for (const router of localRouters) {
    try {
      console.log(`🔍 [PIPE] Checking local router ${router.id}`);
      
      // Check if router has getProducers method
      if (typeof router.getProducers !== 'function') {
        console.warn(`⚠️ [PIPE] Local router ${router.id} does not have getProducers method`);
        continue;
      }
      
      const producers = router.getProducers();
      const found = producers.find(p => p.id === producerId);
      
      if (found) {
        sourceRouter = router;
        originalProducer = found;
        console.log(`✅ [PIPE] Found producer ${producerId} on local router ${router.id}`);
        break;
      }
    } catch (error) {
      console.warn(`⚠️ [PIPE] Error checking router ${router.id}: ${error.message}`);
      continue;
    }
  }

  // If found on local router, pipe using canonical Mediasoup v3 pattern
  if (sourceRouter && originalProducer) {
    console.log(`🔄 [PIPE] Piping producer ${producerId} from router ${sourceRouter.id} to router ${targetRouter.id}`);
    
    try {
      // Use the canonical Mediasoup v3 pattern: router1.pipeToRouter({ producerId, router: router2 })
      const pipeProducerResult = await sourceRouter.pipeToRouter({ 
        producerId, 
        router: targetRouter 
      });
      
      console.log(`✅ [PIPE] Successfully piped producer ${producerId} from ${sourceRouter.id} to ${targetRouter.id}`);
      console.log(`🔗 [PIPE] Piped producer result:`, {
        producerId: pipeProducerResult.pipeProducer?.id,
        consumerId: pipeProducerResult.pipeConsumer?.id
      });
      
      // The pipeToRouter method returns an object with pipeProducer and pipeConsumer
      // The pipeProducer is the new producer on the target router
      if (pipeProducerResult.pipeProducer) {
        // Store the mapping for future reference
        pipeProducerResult.pipeProducer.appData = pipeProducerResult.pipeProducer.appData || {};
        pipeProducerResult.pipeProducer.appData.originalProducerId = producerId;
        
        return pipeProducerResult.pipeProducer.id;
      } else {
        throw new Error('Pipe operation succeeded but no pipeProducer returned');
      }
    } catch (error) {
      console.error(`❌ [PIPE] Failed to pipe producer ${producerId}:`, error);
      throw new Error(`Failed to pipe producer ${producerId}: ${error.message}`);
    }
  }

  // If not found locally, check if we can find it via coordinator
  console.log(`🔍 [PIPE] Producer ${producerId} not found on local routers, checking for cross-node availability`);
  
  // Try to find producer info across nodes via coordinator
  try {
    const allNodes = await routerManager.coordinatorClient.getAllNodes();
    console.log(`📡 [PIPE] Found ${allNodes.length} nodes in cluster`);
    
    // For now, just log the available nodes but don't implement cross-node piping
    // This is where we would query remote nodes for the producer
    for (const node of allNodes) {
      if (node.id !== routerManager.nodeId) {
        console.log(`📡 [PIPE] Remote node ${node.id} at ${node.host}:${node.port} - would need to query for producer ${producerId}`);
      }
    }
    
    throw new Error(`Producer ${producerId} not found on local routers. Cross-node piping requires additional implementation.`);
  } catch (coordError) {
    console.warn(`⚠️ [PIPE] Could not query coordinator for nodes: ${coordError.message}`);
    throw new Error(`Producer ${producerId} not found on any local router and coordinator unavailable.`);
  }
}

// Consume on pipe transport endpoint
module.exports = (dependencies) => async (req, res) => {
  try {
    const { transportId } = req.params;
    const {
      producerId,
      streamId,
      streamName,
      participantId,
      roomId,
      originalProducerId
    } = req.body;

    const {
      transportManager,
      pipeTransportManager,
      roomManager,
      routerManager,
      nodeId
    } = dependencies;

    if (!producerId) {
      return res.status(400).json({ error: 'Missing producerId' });
    }

    console.log(`🔍 [PIPE] Consume request: transportId=${transportId}, producerId=${producerId}`);

    const pipeTransport = await transportManager.getPipeTransport(transportId);
    let pipeConsumer;

    if (!pipeTransport) {
      const legacyTransport = pipeTransportManager.pipeTransports.get(transportId);
      if (!legacyTransport) {
        return res.status(404).json({ error: 'Pipe transport not found' });
      }

      pipeConsumer = await legacyTransport.consume({ producerId });
      pipeTransportManager.pipeConsumers.set(pipeConsumer.id, pipeConsumer);
      console.log(`📦 [LEGACY] Created pipe consumer ${pipeConsumer.id} via legacy transport`);
    } else {
      // Extract the actual transport and router from the stored object
      const actualTransport = pipeTransport.transport;
      const targetRouter = pipeTransport.router;

      if (!targetRouter) {
        console.error(`❌ [PIPE] Transport structure:`, {
          hasTransport: !!actualTransport,
          transportId: actualTransport?.id,
          transportType: typeof actualTransport,
          hasRouter: !!targetRouter,
          routerType: typeof targetRouter
        });
        return res.status(500).json({ error: 'Target router is undefined on pipe transport' });
      }

      console.log(`🎯 [PIPE] Found target router ${targetRouter.id} for transport ${transportId}`);

      // Follow the canonical Mediasoup v3 pattern:
      // 1. Ensure the producer is piped to the target router
      // 2. Use the piped producer ID for consumption
      let pipedProducerId;
      
      try {
        pipedProducerId = await ensureProducerPipedToRouter({ 
          producerId, 
          routerManager, 
          targetRouter 
        });
        console.log(`✅ [PIPE] Producer ${producerId} piped to router ${targetRouter.id} as ${pipedProducerId}`);
      } catch (error) {
        console.error(`❌ [PIPE] Failed to ensure producer is piped:`, error);
        return res.status(500).json({ error: `Failed to pipe producer: ${error.message}` });
      }

      // Now create the pipe consumer using the piped producer ID
      console.log(`🔄 [PIPE] Creating pipe consumer for piped producer ${pipedProducerId} on transport ${transportId}`);

      try {
        // Use the canonical Mediasoup v3 pattern: transport.consume({ producerId })
        pipeConsumer = await actualTransport.consume({ producerId: pipedProducerId });
        console.log(`🚇 [PIPE] Created pipe consumer ${pipeConsumer.id} for piped producer ${pipedProducerId}`);
      } catch (error) {
        console.error(`❌ [PIPE] Failed to create pipe consumer:`, error);
        return res.status(500).json({ error: `Failed to create pipe consumer: ${error.message}` });
      }
    }

    // Register in room
    if (streamId && participantId && roomId && roomManager) {
      let room = roomManager.getRoom(roomId);
      if (!room) {
        room = roomManager.createRoom(roomId);
        console.log(`🏠 [ROOM] Created room ${roomId}`);
      }

      if (!room.participants.has(participantId)) {
        room.participants.set(participantId, {
          id: participantId,
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
          metadata: {
            username: participantId,
            isPiped: true,
            originalNode: nodeId
          }
        });
        console.log(`👤 [ROOM] Added participant ${participantId} to room ${roomId}`);
      }

      const participant = room.participants.get(participantId);
      participant.producers.set(pipeConsumer.id, {
        id: pipeConsumer.id,
        kind: pipeConsumer.kind,
        originalProducerId: producerId,
        isPiped: true,
        sourceNode: nodeId
      });

      console.log(`📤 [STREAM] Registered piped stream ${streamId} for participant ${participantId}`);
    }

    res.status(200).json({
      id: pipeConsumer.id,
      producerId: pipeConsumer.producerId,
      originalProducerId: producerId, // Keep reference to original producer ID
      kind: pipeConsumer.kind,
      rtpParameters: pipeConsumer.rtpParameters
    });
  } catch (error) {
    console.error(`❌ [PIPE] Failed to create pipe consumer:`, error);
    res.status(500).json({ error: error.message });
  }
};