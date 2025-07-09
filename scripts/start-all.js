const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting MediaSoup Multi-Node System...\n');

const processes = [];

// Colors for different processes
const colors = {
  coordinator: '\x1b[31m', // Red
  signaling: '\x1b[36m',   // Cyan
  sfu1: '\x1b[32m',        // Green
  sfu2: '\x1b[33m',        // Yellow
  sfu3: '\x1b[35m',        // Magenta
  web: '\x1b[34m',         // Blue
  reset: '\x1b[0m'
};

function createLogger(name, color) {
  return (data) => {
    const timestamp = new Date().toISOString().substr(11, 8);
    const lines = data.toString().split('\n').filter(line => line.trim());
    lines.forEach(line => {
      console.log(`${color}[${timestamp}] [${name.toUpperCase()}]${colors.reset} ${line}`);
    });
  };
}

function startProcess(name, command, args, env = {}) {
  console.log(`Starting ${name}...`);
  
  const childProcess = spawn(command, args, {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...env },
    stdio: 'pipe'
  });
  
  const logger = createLogger(name, colors[name] || colors.reset);
  
  childProcess.stdout.on('data', logger);
  childProcess.stderr.on('data', logger);
  
  childProcess.on('close', (code) => {
    console.log(`${colors[name]}[${name.toUpperCase()}] Process exited with code ${code}${colors.reset}`);
  });
  
  processes.push(childProcess);
  return childProcess;
}

// Start coordinator first
const coordinatorProcess = startProcess('coordinator', 'node', ['src/server.js'], {
  NODE_ID: 'coordinator',
  IS_COORDINATOR: 'true',
  COORDINATOR_PORT: '4000',
  PORT: '4001' // Use different port for coordinator SFU functionality
});

// Wait for coordinator to start, then start SFU nodes
setTimeout(() => {
  // Start SFU nodes
  startProcess('sfu1', 'node', ['src/server.js'], {
    NODE_ID: 'sfu1',
    PORT: '3001',
    COORDINATOR_URL: 'http://localhost:4000'
  });
  
  setTimeout(() => {
    startProcess('sfu2', 'node', ['src/server.js'], {
      NODE_ID: 'sfu2',
      PORT: '3002',
      COORDINATOR_URL: 'http://localhost:4000'
    });
  }, 2000);
  
  setTimeout(() => {
    startProcess('sfu3', 'node', ['src/server.js'], {
      NODE_ID: 'sfu3',
      PORT: '3003',
      COORDINATOR_URL: 'http://localhost:4000'
    });
  }, 4000);
  
  // Remove web server - serve static files from SFU1
  console.log('🌐 Web Interface will be served from SFU1: http://localhost:3001');
  
  // Show startup complete message
  setTimeout(() => {
    console.log('\n🎉 All servers started!');
    console.log('🎯 Coordinator: http://localhost:4000/api/visualization');
    console.log('🚀 SFU1: http://localhost:3001/api/health');
    console.log('🚀 SFU2: http://localhost:3002/api/health');
    console.log('🚀 SFU3: http://localhost:3003/api/health');
    console.log('🌐 Web Interface: http://localhost:2020');
    console.log('\n📱 Client Interfaces:');
    console.log('🏠 Main Dashboard: http://localhost:2020/index.html');
    console.log('\nPress Ctrl+C to stop all servers\n');
  }, 8000);
}, 2000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down all servers...');
  
  processes.forEach((proc, index) => {
    proc.kill('SIGTERM');
  });
  
  setTimeout(() => {
    console.log('✅ All servers stopped');
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  processes.forEach(proc => proc.kill('SIGTERM'));
  process.exit(0);
});
