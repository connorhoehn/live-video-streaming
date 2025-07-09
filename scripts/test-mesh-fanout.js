#!/usr/bin/env node

/**
 * Test script to create a stream with mock producers and test mesh fan-out
 */

const fetch = require('node-fetch');

// Handle node-fetch v3 ES module
const actualFetch = fetch.default || fetch;

// Configuration
const SFU_NODES = [
  { id: 'sfu1', port: 3001, url: 'http://localhost:3001' },
  { id: 'sfu2', port: 3002, url: 'http://localhost:3002' },
  { id: 'sfu3', port: 3003, url: 'http://localhost:3003' }
];

const COORDINATOR_URL = 'http://localhost:3000';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkNodeStatus(node) {
  try {
    const response = await actualFetch(`${node.url}/api/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function createTestStream(nodeUrl, streamName) {
  try {
    console.log(`🎬 Creating stream "${streamName}" on ${nodeUrl}...`);
    
    // 1. First create the stream record
    const streamResponse = await actualFetch(`${nodeUrl}/api/streams/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        streamName: streamName
      })
    });
    
    if (!streamResponse.ok) {
      throw new Error(`Failed to create stream: HTTP ${streamResponse.status}: ${streamResponse.statusText}`);
    }
    
    const streamData = await streamResponse.json();
    console.log(`✅ Stream record created:`, streamData);
    
    // 2. Create a room for the stream
    const roomId = `room_${Date.now()}`;
    const participantId = `participant_${Date.now()}`;
    
    const roomResponse = await actualFetch(`${nodeUrl}/api/rooms/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId: roomId
      })
    });
    
    if (!roomResponse.ok) {
      throw new Error(`Failed to create room: HTTP ${roomResponse.status}: ${roomResponse.statusText}`);
    }
    
    const roomData = await roomResponse.json();
    console.log(`🏠 Room created:`, roomData);
    
    // Join the room as a participant
    const joinResponse = await actualFetch(`${nodeUrl}/api/rooms/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId: roomId,
        participantId: participantId
      })
    });
    
    if (!joinResponse.ok) {
      throw new Error(`Failed to join room: HTTP ${joinResponse.status}: ${joinResponse.statusText}`);
    }
    
    const joinData = await joinResponse.json();
    console.log(`👤 Joined room:`, joinData);
    
    // 3. Create a producer transport (simulating what a real client would do)
    const transportResponse = await actualFetch(`${nodeUrl}/api/transports/producer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId: roomId,
        participantId: participantId,
        type: 'producer'
      })
    });
    
    if (!transportResponse.ok) {
      throw new Error(`Failed to create transport: HTTP ${transportResponse.status}: ${transportResponse.statusText}`);
    }
    
    const transportData = await transportResponse.json();
    console.log(`🚗 Transport created:`, transportData.id);
    
    // 4. Connect the transport (simulating WebRTC connection)
    const connectResponse = await actualFetch(`${nodeUrl}/api/transports/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transportId: transportData.id,
        dtlsParameters: {
          // Mock DTLS parameters
          role: 'server',
          fingerprints: [{
            algorithm: 'sha-256',
            value: 'mock:fingerprint'
          }]
        }
      })
    });
    
    if (!connectResponse.ok) {
      throw new Error(`Failed to connect transport: HTTP ${connectResponse.status}: ${connectResponse.statusText}`);
    }
    
    console.log(`🔗 Transport connected`);
    
    // 5. Create a mock video producer (this should trigger mesh fan-out)
    const produceResponse = await actualFetch(`${nodeUrl}/api/transports/produce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transportId: transportData.id,
        kind: 'video',
        roomId: roomId,
        participantId: participantId,
        rtpParameters: {
          // Mock RTP parameters for video
          mid: '0',
          codecs: [{
            mimeType: 'video/VP8',
            payloadType: 96,
            clockRate: 90000,
            parameters: {}
          }],
          headerExtensions: [],
          encodings: [{
            ssrc: 12345678
          }],
          rtcp: {
            cname: `test-${Date.now()}`,
            reducedSize: true
          }
        }
      })
    });
    
    if (!produceResponse.ok) {
      throw new Error(`Failed to create producer: HTTP ${produceResponse.status}: ${produceResponse.statusText}`);
    }
    
    const producerData = await produceResponse.json();
    console.log(`📤 Video producer created:`, producerData.id);
    
    return {
      streamId: streamData.streamId,
      streamName: streamData.name,
      roomId: roomId,
      participantId: participantId,
      transportId: transportData.id,
      producerId: producerData.id
    };
    
  } catch (error) {
    console.error(`❌ Failed to create stream:`, error.message);
    return null;
  }
}

async function getStreams(nodeUrl) {
  try {
    const response = await actualFetch(`${nodeUrl}/api/streams`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`❌ Failed to get streams from ${nodeUrl}:`, error.message);
    return null;
  }
}

async function getNodeInfo(nodeUrl) {
  try {
    const response = await actualFetch(`${nodeUrl}/api/info`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`❌ Failed to get node info from ${nodeUrl}:`, error.message);
    return null;
  }
}

async function getRooms(nodeUrl) {
  try {
    const response = await actualFetch(`${nodeUrl}/api/rooms`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`❌ Failed to get rooms from ${nodeUrl}:`, error.message);
    return null;
  }
}

async function getRoomInfo(nodeUrl, roomId) {
  try {
    const response = await actualFetch(`${nodeUrl}/api/rooms/${roomId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`❌ Failed to get room info from ${nodeUrl}:`, error.message);
    return null;
  }
}

async function testMeshFanOut() {
  console.log('🚀 Starting mesh fan-out test...\n');
  
  // Check if all nodes are running
  console.log('📡 Checking node status...');
  for (const node of SFU_NODES) {
    const isRunning = await checkNodeStatus(node);
    console.log(`  ${node.id}: ${isRunning ? '✅ Running' : '❌ Not running'}`);
    if (!isRunning) {
      console.log(`❌ Node ${node.id} is not running. Please start all nodes first.`);
      return;
    }
  }
  
  console.log('\n📊 Getting initial node info...');
  for (const node of SFU_NODES) {
    const info = await getNodeInfo(node.url);
    if (info) {
      console.log(`  ${node.id}: ${info.nodeId} (${info.streams || 0} streams)`);
    }
  }
  
  console.log('\n📋 Getting initial stream counts...');
  const initialStreams = {};
  for (const node of SFU_NODES) {
    const streams = await getStreams(node.url);
    if (streams) {
      initialStreams[node.id] = streams.length;
      console.log(`  ${node.id}: ${streams.length} streams`);
    }
  }
  
  // Create a test stream on SFU1
  console.log('\n🎬 Creating test stream on SFU1...');
  const testStreamName = `Test Stream ${Date.now()}`;
  const stream = await createTestStream(SFU_NODES[0].url, testStreamName);
  
  if (!stream) {
    console.log('❌ Failed to create test stream');
    return;
  }
  
  // Wait a bit for mesh fan-out to propagate
  console.log('\n⏳ Waiting for mesh fan-out to propagate...');
  await delay(5000);
  
  // Check if stream is visible on all nodes by checking rooms and participants
  console.log('\n📋 Checking mesh fan-out results on all nodes...');
  for (const node of SFU_NODES) {
    console.log(`\n🔍 Checking node ${node.id}:`);
    
    // Check rooms
    const rooms = await getRooms(node.url);
    if (rooms) {
      console.log(`  📁 Rooms: ${Object.keys(rooms).length}`);
      
      // Look for our test room
      const testRoom = rooms[stream.roomId];
      if (testRoom) {
        console.log(`  ✅ Test room found: ${stream.roomId}`);
        console.log(`  👥 Participants: ${Object.keys(testRoom.participants || {}).length}`);
        
        // Check if our participant exists
        const testParticipant = testRoom.participants[stream.participantId];
        if (testParticipant) {
          console.log(`  ✅ Test participant found: ${stream.participantId}`);
          console.log(`  📤 Producers: ${Object.keys(testParticipant.producers || {}).length}`);
          
          // List producers
          Object.entries(testParticipant.producers || {}).forEach(([prodId, producer]) => {
            console.log(`    📺 Producer ${prodId}: ${producer.kind} ${producer.isPiped ? '(piped)' : '(local)'}`);
          });
        } else {
          console.log(`  ❌ Test participant not found: ${stream.participantId}`);
        }
      } else {
        console.log(`  ❌ Test room not found: ${stream.roomId}`);
      }
    } else {
      console.log(`  ❌ Failed to get rooms from ${node.id}`);
    }
    
    // Also check streams endpoint for completeness
    const streams = await getStreams(node.url);
    if (streams) {
      console.log(`  📺 Streams: ${streams.length}`);
    }
  }
  
  console.log('\n🏁 Test complete!');
}

if (require.main === module) {
  testMeshFanOut().catch(console.error);
}

module.exports = { testMeshFanOut };
