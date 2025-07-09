#!/usr/bin/env node

/**
 * Initialize pipe transport connections between all SFU nodes
 * This should be run after all SFUs are started and registered
 * Stores pipe transport information in Redis
 */

const { makeHttpRequest } = require('../src/utils/http');
const RedisMeshState = require('../src/services/redis-mesh-state');

const SFU_NODES = [
  { id: 'sfu1', host: 'localhost', port: 3001 },
  { id: 'sfu2', host: 'localhost', port: 3002 },
  { id: 'sfu3', host: 'localhost', port: 3003 }
];

const COORDINATOR_URL = 'http://localhost:4000';

let redisMesh;

async function initializeRedis() {
  console.log('🔗 Connecting to Redis for mesh coordination...');
  redisMesh = new RedisMeshState({
    nodeId: 'pipe-init',
    redisUrl: 'redis://localhost:6377'
  });
  await redisMesh.connect();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNodes() {
  console.log('🔍 Waiting for all SFU nodes to be ready...');
  
  const maxRetries = 30;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const response = await makeHttpRequest(`${COORDINATOR_URL}/api/nodes`);
      const nodes = JSON.parse(response);
      
      if (nodes.length >= SFU_NODES.length) {
        console.log(`✅ Found ${nodes.length} registered nodes`);
        return nodes;
      }
      
      console.log(`⏳ Found ${nodes.length}/${SFU_NODES.length} nodes, waiting...`);
      await sleep(2000);
      retries++;
    } catch (error) {
      console.log(`⏳ Coordinator not ready yet, retrying... (${retries}/${maxRetries})`);
      await sleep(2000);
      retries++;
    }
  }
  
  throw new Error('Timeout waiting for SFU nodes to be ready');
}

async function createPipeTransport(sourceNode, targetNode) {
  try {
    console.log(`🚇 Creating pipe transport: ${sourceNode.id} -> ${targetNode.id}`);
    
    // Create pipe transport on source node
    const createResponse = await makeHttpRequest({
      hostname: sourceNode.host,
      port: sourceNode.port,
      path: '/api/pipe-transports/create',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      targetNodeId: targetNode.id,
      routerId: null // Use default router
    });
    
    const sourcePipeData = JSON.parse(createResponse);
    console.log(`✅ Created pipe transport ${sourcePipeData.id} on ${sourceNode.id}`);
    
    // Create matching pipe transport on target node
    const targetCreateResponse = await makeHttpRequest({
      hostname: targetNode.host,
      port: targetNode.port,
      path: '/api/pipe-transports/create',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      targetNodeId: sourceNode.id,
      routerId: null // Use default router
    });
    
    const targetPipeData = JSON.parse(targetCreateResponse);
    console.log(`✅ Created pipe transport ${targetPipeData.id} on ${targetNode.id}`);
    
    // Connect source pipe transport to target
    await makeHttpRequest({
      hostname: sourceNode.host,
      port: sourceNode.port,
      path: `/api/pipe-transports/${sourcePipeData.id}/connect`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      ip: targetPipeData.ip,
      port: targetPipeData.port,
      srtpParameters: targetPipeData.srtpParameters
    });
    
    console.log(`🔗 Connected ${sourceNode.id} pipe transport to ${targetNode.id}`);
    
    // Connect target pipe transport back to source
    await makeHttpRequest({
      hostname: targetNode.host,
      port: targetNode.port,
      path: `/api/pipe-transports/${targetPipeData.id}/connect`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      ip: sourcePipeData.ip,
      port: sourcePipeData.port,
      srtpParameters: sourcePipeData.srtpParameters
    });
    
    console.log(`🔗 Connected ${targetNode.id} pipe transport back to ${sourceNode.id}`);
    
    // Store both pipe transports in Redis for mesh coordination
    await redisMesh.storePipeTransport(sourceNode.id, targetNode.id, sourcePipeData);
    await redisMesh.storePipeTransport(targetNode.id, sourceNode.id, targetPipeData);
    
    return {
      sourceTransport: sourcePipeData,
      targetTransport: targetPipeData
    };
    
  } catch (error) {
    console.error(`❌ Failed to create pipe transport ${sourceNode.id} -> ${targetNode.id}:`, error.message);
    throw error;
  }
}

async function pipeProducersToTarget(sourceNode, targetNode, transportId) {
  try {
    console.log(`🔍 Fetching producers from ${sourceNode.id}...`);
    
    // Fetch all producers from source node
    const response = await makeHttpRequest({
      hostname: sourceNode.host,
      port: sourceNode.port,
      path: '/api/producers',
      method: 'GET'
    });

    const producers = JSON.parse(response);
    console.log(`📤 Found ${producers.length} producers on ${sourceNode.id}`);

    if (producers.length === 0) {
      console.log(`ℹ️  No producers to pipe from ${sourceNode.id} to ${targetNode.id}`);
      return;
    }

    // Pipe each producer to the target node
    for (const producer of producers) {
      const body = {
        producerId: producer.id,
        participantId: producer.participantId,
        roomId: producer.roomId,
        streamId: producer.streamId,
        streamName: producer.streamName,
        originalProducerId: producer.originalProducerId || producer.id,
        sourceNodeId: sourceNode.id
      };

      const consumePath = `/api/pipe-transports/${transportId}/consume`;
      console.log(`📡 Piping producer ${producer.id} (${producer.kind}) to ${targetNode.id} via transport ${transportId}`);

      try {
        const consumeResponse = await makeHttpRequest({
          hostname: targetNode.host,
          port: targetNode.port,
          path: consumePath,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, body);

        const consumeData = JSON.parse(consumeResponse);
        console.log(`✅ Successfully piped producer ${producer.id} to ${targetNode.id} (consumer: ${consumeData.id})`);
      } catch (error) {
        console.error(`❌ Failed to pipe producer ${producer.id} to ${targetNode.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`❌ Failed to pipe producers from ${sourceNode.id} to ${targetNode.id}:`, error.message);
  }
}

async function initializePipeLinks() {
  try {
    console.log('🚀 Initializing pipe transport links between SFU nodes...');
    
    // Initialize Redis connection
    await initializeRedis();
    
    // Wait for all nodes to be ready
    const nodes = await waitForNodes();
    
    // Create pipe transports between all pairs of nodes
    const pipeConnections = [];
    
    for (let i = 0; i < SFU_NODES.length; i++) {
      for (let j = i + 1; j < SFU_NODES.length; j++) {
        const sourceNode = SFU_NODES[i];
        const targetNode = SFU_NODES[j];
        
        try {
          const connection = await createPipeTransport(sourceNode, targetNode);
          pipeConnections.push({
            source: sourceNode.id,
            target: targetNode.id,
            sourceTransport: connection.sourceTransport,
            targetTransport: connection.targetTransport
          });
          
          console.log(`✅ Established bidirectional pipe link: ${sourceNode.id} ↔ ${targetNode.id}`);
          
          // After establishing the pipe connection, pipe any existing producers
          console.log(`🔄 Piping existing producers from ${sourceNode.id} to ${targetNode.id}...`);
          await pipeProducersToTarget(sourceNode, targetNode, connection.targetTransport.id);
          
          console.log(`🔄 Piping existing producers from ${targetNode.id} to ${sourceNode.id}...`);
          await pipeProducersToTarget(targetNode, sourceNode, connection.sourceTransport.id);
          
        } catch (error) {
          console.error(`❌ Failed to establish pipe link: ${sourceNode.id} ↔ ${targetNode.id}`);
        }
      }
    }
    
    console.log(`\n🎉 Pipe initialization completed!`);
    console.log(`✅ Created ${pipeConnections.length} bidirectional pipe connections`);
    
    // Save pipe connection info for reference
    const pipeInfo = {
      timestamp: new Date().toISOString(),
      connections: pipeConnections
    };
    
    console.log('\n📋 Pipe Connection Summary:');
    pipeConnections.forEach(conn => {
      console.log(`  ${conn.source} ↔ ${conn.target}: ${conn.sourceTransport.id} ↔ ${conn.targetTransport.id}`);
    });
    
    return pipeInfo;
    
  } catch (error) {
    console.error('❌ Failed to initialize pipe links:', error.message);
    process.exit(1);
  }
}

// Run the initialization if this script is executed directly
if (require.main === module) {
  initializePipeLinks()
    .then(async () => {
      console.log('\n🎊 All pipe links initialized successfully!');
      console.log('🎥 You can now start streaming - the mesh should work correctly.');
      
      // Cleanup Redis connection
      if (redisMesh) {
        await redisMesh.disconnect();
      }
      
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('❌ Pipe initialization failed:', error.message);
      
      // Cleanup Redis connection
      if (redisMesh) {
        await redisMesh.disconnect();
      }
      
      process.exit(1);
    });
}

module.exports = { initializePipeLinks };
