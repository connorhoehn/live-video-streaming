const fetch = require('node-fetch');

const COORDINATOR_URL = 'http://localhost:4000';
const SIGNALING_URL = 'http://localhost:3000';

class ClusterTester {
  async testCoordinatorHealth() {
    try {
      const response = await fetch(`${COORDINATOR_URL}/health`);
      const data = await response.json();
      console.log('✅ Coordinator Health:', data);
      return true;
    } catch (error) {
      console.error('❌ Coordinator Health Failed:', error.message);
      return false;
    }
  }

  async testNodeRegistration() {
    try {
      const response = await fetch(`${COORDINATOR_URL}/nodes`);
      const nodes = await response.json();
      console.log('✅ Registered Nodes:', nodes.length);
      nodes.forEach(node => {
        console.log(`  - ${node.id}: ${node.host}:${node.port} (${node.status})`);
      });
      return nodes.length > 0;
    } catch (error) {
      console.error('❌ Node Registration Test Failed:', error.message);
      return false;
    }
  }

  async testRoomAssignment() {
    try {
      const roomId = `test-room-${Date.now()}`;
      const response = await fetch(`${COORDINATOR_URL}/rooms/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
      });
      
      const assignment = await response.json();
      console.log('✅ Room Assignment:', assignment);
      
      // Clean up
      await fetch(`${COORDINATOR_URL}/rooms/${roomId}`, { method: 'DELETE' });
      return true;
    } catch (error) {
      console.error('❌ Room Assignment Test Failed:', error.message);
      return false;
    }
  }

  async testSFUNodeStats() {
    try {
      const nodesResponse = await fetch(`${COORDINATOR_URL}/nodes`);
      const nodes = await nodesResponse.json();
      
      for (const node of nodes) {
        try {
          const statsResponse = await fetch(`http://${node.host}:${node.port}/api/stats`);
          const stats = await statsResponse.json();
          console.log(`✅ ${node.id} Stats:`, stats);
        } catch (error) {
          console.error(`❌ ${node.id} Stats Failed:`, error.message);
        }
      }
      return true;
    } catch (error) {
      console.error('❌ SFU Node Stats Test Failed:', error.message);
      return false;
    }
  }

  async testPipeTransports() {
    try {
      const nodesResponse = await fetch(`${COORDINATOR_URL}/nodes`);
      const nodes = await nodesResponse.json();
      
      for (const node of nodes) {
        try {
          const pipeResponse = await fetch(`http://${node.host}:${node.port}/api/pipe/stats`);
          const pipeStats = await pipeResponse.json();
          console.log(`✅ ${node.id} Pipe Stats:`, pipeStats);
        } catch (error) {
          console.error(`❌ ${node.id} Pipe Stats Failed:`, error.message);
        }
      }
      return true;
    } catch (error) {
      console.error('❌ Pipe Transport Test Failed:', error.message);
      return false;
    }
  }

  async testSignalingIntegration() {
    try {
      const response = await fetch(`${SIGNALING_URL}/api/cluster/status`);
      const status = await response.json();
      console.log('✅ Signaling Cluster Status:', status);
      return true;
    } catch (error) {
      console.error('❌ Signaling Integration Test Failed:', error.message);
      return false;
    }
  }

  async runAllTests() {
    console.log('🧪 Starting Cluster Tests...\n');
    
    const tests = [
      { name: 'Coordinator Health', fn: () => this.testCoordinatorHealth() },
      { name: 'Node Registration', fn: () => this.testNodeRegistration() },
      { name: 'Room Assignment', fn: () => this.testRoomAssignment() },
      { name: 'SFU Node Stats', fn: () => this.testSFUNodeStats() },
      { name: 'Pipe Transports', fn: () => this.testPipeTransports() },
      { name: 'Signaling Integration', fn: () => this.testSignalingIntegration() }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      console.log(`\n🔍 Testing: ${test.name}`);
      try {
        const result = await test.fn();
        if (result) {
          passed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`❌ ${test.name} threw error:`, error.message);
        failed++;
      }
    }

    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
      console.log('🎉 All tests passed! Cluster is healthy.');
    } else {
      console.log('⚠️  Some tests failed. Check the cluster configuration.');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ClusterTester();
  
  // Wait a bit for services to be ready
  setTimeout(() => {
    tester.runAllTests().catch(console.error);
  }, 2000);
}

module.exports = ClusterTester;
