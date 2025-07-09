const { makeHttpRequest } = require('../../utils/http');

module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { transportId } = req.body;
      const { kind, rtpParameters, roomId, participantId } = req.body;
      const { transportManager, roomManager, meshCoordinator, routerManager } = dependencies;
    
    if (!kind || !rtpParameters) {
      return res.status(400).json({ error: 'Missing kind or rtpParameters' });
    }
    
    // Create producer
    console.log(`📤 [PRODUCE] Creating producer for ${kind} on transport ${transportId}`);
    console.log(`📤 [PRODUCE] Request body:`, { transportId, kind, rtpParameters: !!rtpParameters, roomId, participantId });
    const producer = await transportManager.createProducer(transportId, { kind, rtpParameters });
    
    // If roomId and participantId provided, add producer to room
    if (roomId && participantId) {
      console.log(`📤 [PRODUCE] Adding producer to room ${roomId} for participant ${participantId}`);
      const room = roomManager.getRoom(roomId);
      if (room) {
        await roomManager.addProducerToParticipant(roomId, participantId, producer.id, { kind });
        console.log(`📤 [PRODUCE] Producer ${producer.id} added to room ${roomId} for participant ${participantId}`);
        
        // **NEW: Automatic mesh/fan-out logic**
        await performMeshFanOut(producer.id, roomId, participantId, kind, dependencies, producer.rtpParameters);
      } else {
        console.log(`❌ [PRODUCE] Room ${roomId} not found!`);
      }
    } else {
      console.log(`⚠️  [PRODUCE] Missing roomId or participantId - skipping room assignment`);
    }
    
    console.log(`📤 Producer created successfully: ${producer.id}`);
    res.status(200).json({ id: producer.id });
  } catch (error) {
    console.error('Error creating producer:', error);
    res.status(500).json({ error: error.message });
  }
  };
};

/**
 * Perform mesh/fan-out when a producer is created
 * This pipes the producer to other SFU nodes using pre-established pipe transports
 */
async function performMeshFanOut(producerId, roomId, participantId, kind, dependencies, rtpParameters) {
  try {
    const { meshCoordinator, routerManager, nodeId, redisMesh } = dependencies;
    
    if (!meshCoordinator || !redisMesh) {
      console.log(`⚠️  [MESH] No mesh coordinator or Redis state available for fan-out`);
      return;
    }
    
    console.log(`🌐 [MESH] Starting fan-out for producer ${producerId} (${kind}) in room ${roomId}`);
    
    // 1. Discover other SFU nodes in the mesh
    const otherNodes = await meshCoordinator.discoverNodes();
    const targetNodes = otherNodes.filter(node => node.id !== nodeId);
    
    if (targetNodes.length === 0) {
      console.log(`📡 [MESH] No other nodes found for fan-out`);
      return;
    }
    
    console.log(`🔍 [MESH] Found ${targetNodes.length} target nodes for fan-out:`, targetNodes.map(n => n.id));
    
    // 2. Use pre-established pipe transports for each target node
    for (const targetNode of targetNodes) {
      try {
        console.log(`🔄 [MESH] Using pre-established pipe to node ${targetNode.id} for producer ${producerId}`);
        
        // Get the pre-established pipe transport info from Redis
        const pipeInfo = await redisMesh.getPipeTransport(nodeId, targetNode.id);
        
        if (!pipeInfo) {
          console.error(`❌ [MESH] No pre-established pipe transport found for ${nodeId} -> ${targetNode.id}`);
          continue;
        }
        
        console.log(`🚇 [MESH] Using pipe transport ${pipeInfo.id} -> ${targetNode.id}`);
        
        // Get local router
        const localRouter = routerManager.getDefaultRouter();
        if (!localRouter) {
          console.error(`❌ [MESH] No local router available for piping`);
          continue;
        }
        
        // Get the local pipe transport from our transport manager
        const { transportManager } = dependencies;
        const localPipeTransport = transportManager.pipeTransports.get(pipeInfo.id);
        
        if (!localPipeTransport) {
          console.error(`❌ [MESH] Local pipe transport ${pipeInfo.id} not found`);
          continue;
        }
        
        // Get the original producer to get its RTP parameters
        const originalProducer = transportManager.getProducer(producerId);
        if (!originalProducer) {
          console.error(`❌ [MESH] Original producer ${producerId} not found`);
          continue;
        }
        
        // Create pipe producer on the pre-established pipe transport
        const pipeProducer = await localPipeTransport.transport.produce({
          kind: kind,
          rtpParameters: originalProducer.rtpParameters
        });
        
        console.log(`📤 [MESH] Pipe producer created: ${pipeProducer.id} -> ${targetNode.id}`);
        
        // Store the pipe producer info in Redis for coordination
        await redisMesh.setPipeProducer(`producer:${nodeId}:${targetNode.id}:${producerId}`, {
          pipeProducerId: pipeProducer.id,
          originalProducerId: producerId,
          sourceNodeId: nodeId,
          targetNodeId: targetNode.id,
          roomId: roomId,
          participantId: participantId,
          kind: kind,
          rtpParameters: rtpParameters,
          streamId: `${roomId}_${participantId}`,
          streamName: `${participantId}'s stream`,
          localTransportId: pipeInfo.id,
          remoteTransportId: null  // We'll need to get this from the target node
        });
        
        // Wait a bit to ensure the pipe producer is fully available
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get the remote pipe transport ID on the target node
        const remotePipeInfo = await redisMesh.getPipeTransport(targetNode.id, nodeId);
        if (!remotePipeInfo) {
          console.error(`❌ [MESH] No remote pipe transport found for ${targetNode.id} -> ${nodeId}`);
          continue;
        }
        
        // Create pipe consumer on target node's pipe transport
        console.log(`🔍 [MESH] Sending pipe consume request to ${targetNode.id}`);
        
        const pipeConsumerResponse = await makeHttpRequest(`http://${targetNode.host}:${targetNode.port}/api/pipe-transports/${remotePipeInfo.id}/consume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            producerId: pipeProducer.id,
            streamId: `${roomId}_${participantId}`,
            streamName: `${participantId}'s stream`,
            participantId: participantId,
            roomId: roomId,
            originalProducerId: producerId,
            sourceNodeId: nodeId
          }
        });
        
        const pipeConsumerData = JSON.parse(pipeConsumerResponse);
        console.log(`📥 [MESH] Pipe consumer created: ${pipeConsumerData.id} on ${targetNode.id}`);
        
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
