#!/usr/bin/env node

/**
 * Complete mesh fan-out test workflow
 * This script handles the entire process: start servers, initialize pipes, test fan-out
 */

const { spawn } = require('child_process');
const { testMeshFanOut } = require('./test-mesh-fanout');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: options.background ? 'ignore' : 'inherit',
      detached: options.background,
      ...options
    });
    
    if (options.background) {
      // For background processes, resolve immediately
      console.log(`📡 Started background process: ${command} (PID: ${child.pid})`);
      resolve({ code: 0, pid: child.pid });
      return;
    }
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Command completed: ${command}`);
        resolve({ code });
      } else {
        console.log(`❌ Command failed: ${command} (exit code: ${code})`);
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      console.error(`❌ Command error: ${command}`, error);
      reject(error);
    });
  });
}

async function checkNodeHealth() {
  const nodes = [
    { id: 'sfu1', url: 'http://localhost:3001' },
    { id: 'sfu2', url: 'http://localhost:3002' },
    { id: 'sfu3', url: 'http://localhost:3003' }
  ];
  
  console.log('🔍 Checking node health...');
  
  for (const node of nodes) {
    try {
      const fetch = require('node-fetch');
      const actualFetch = fetch.default || fetch;
      const response = await actualFetch(`${node.url}/api/health`);
      if (response.ok) {
        console.log(`  ✅ ${node.id}: Running`);
      } else {
        console.log(`  ❌ ${node.id}: HTTP ${response.status}`);
        return false;
      }
    } catch (error) {
      console.log(`  ❌ ${node.id}: ${error.message}`);
      return false;
    }
  }
  
  return true;
}

async function fullTest() {
  console.log('🎯 Starting complete mesh fan-out test workflow...\n');
  
  try {
    // Step 1: Kill any existing processes
    console.log('🛑 Cleaning up existing processes...');
    try {
      await runCommand('pkill', ['-f', 'node.*src/app.js']);
      await runCommand('pkill', ['-f', 'node.*src/server.js']);
      await runCommand('pkill', ['-f', 'node.*scripts/start-all.js']);
      await delay(2000); // Wait for cleanup
    } catch (error) {
      // It's okay if no processes were found to kill
      console.log('  (No existing processes found)');
    }
    
    // Step 2: Start all servers
    console.log('\n📡 Starting all SFU servers...');
    await runCommand('node', ['scripts/start-all.js'], { background: true });
    
    // Step 3: Wait for servers to be ready
    console.log('\n⏳ Waiting for servers to initialize...');
    await delay(10000); // Give servers time to start
    
    // Step 4: Check if all nodes are healthy
    const allHealthy = await checkNodeHealth();
    if (!allHealthy) {
      throw new Error('Not all nodes are healthy');
    }
    
    // Step 5: Initialize pipe links
    console.log('\n🔗 Initializing pipe transport links...');
    await runCommand('node', ['scripts/init-pipe-links.js']);
    
    // Step 6: Wait a bit for pipe links to be established
    console.log('\n⏳ Waiting for pipe links to stabilize...');
    await delay(3000);
    
    // Step 7: Run mesh fan-out test
    console.log('\n🎬 Running mesh fan-out test...');
    await testMeshFanOut();
    
    console.log('\n🎉 Complete workflow finished successfully!');
    
  } catch (error) {
    console.error('\n❌ Workflow failed:', error.message);
    process.exit(1);
  }
}

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...');
  require('child_process').exec('pkill -f "node.*src/app.js"');
  require('child_process').exec('pkill -f "node.*src/server.js"');
  require('child_process').exec('pkill -f "node.*scripts/start-all.js"');
  process.exit(0);
});

if (require.main === module) {
  fullTest().catch(console.error);
}

module.exports = { fullTest };
