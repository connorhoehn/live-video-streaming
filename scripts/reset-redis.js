#!/usr/bin/env node

/**
 * Reset Redis mesh state
 * Clears all pipe transport and producer state from Redis
 */

const redis = require('redis');

async function resetRedisState() {
  console.log('🧹 Resetting Redis mesh state...');
  
  const client = redis.createClient({
    url: 'redis://localhost:6377',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
  });
  
  try {
    await client.connect();
    console.log('🔗 Connected to Redis');
    
    // Clear all pipe transport keys
    const pipeKeys = await client.keys('pipe:*');
    if (pipeKeys.length > 0) {
      await client.del(pipeKeys);
      console.log(`🧹 Cleared ${pipeKeys.length} pipe transport keys`);
    }
    
    // Clear all producer keys
    const producerKeys = await client.keys('producer:*');
    if (producerKeys.length > 0) {
      await client.del(producerKeys);
      console.log(`🧹 Cleared ${producerKeys.length} producer keys`);
    }
    
    // Clear all node registration keys
    const nodeKeys = await client.keys('node:*');
    if (nodeKeys.length > 0) {
      await client.del(nodeKeys);
      console.log(`🧹 Cleared ${nodeKeys.length} node registration keys`);
    }
    
    console.log('✅ Redis state reset complete');
    
  } catch (error) {
    console.error('❌ Failed to reset Redis state:', error);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

if (require.main === module) {
  resetRedisState();
}

module.exports = { resetRedisState };
