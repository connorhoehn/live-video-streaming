// Signaling Server API routes
const express = require('express');
const router = express.Router();

module.exports = (dependencies) => {
  const { peerManager, metricsManager } = dependencies;

  // SFU node registration endpoint
  router.post('/register-sfu', (req, res) => {
    const { nodeId, port, capabilities } = req.body;
    
    metricsManager.addSfuNode(nodeId, {
      port,
      capabilities,
      connections: 0,
      status: 'active'
    });
    
    console.log(`✅ SFU Node registered: ${nodeId} on port ${port}`);
    
    res.json({ success: true, nodeId });
  });

  // Smart SFU node selection for multi-node streaming
  router.post('/select-sfu-node', (req, res) => {
    try {
      const { streamId, operation, excludeNodes = [] } = req.body;
      
      // Select best node based on load
      const bestNode = metricsManager.selectBestSfuNode(excludeNodes);
      
      if (!bestNode) {
        return res.status(503).json({ 
          error: 'No available SFU nodes',
          availableNodes: 0
        });
      }
      
      // Update connection count
      metricsManager.updateSfuNodeConnections(bestNode.nodeId, bestNode.connections + 1);
      
      // Track stream mapping
      if (streamId) {
        peerManager.addStreamMapping(streamId, {
          nodeId: bestNode.nodeId,
          port: bestNode.port,
          operation,
          assignedAt: Date.now()
        });
      }
      
      res.json({
        success: true,
        nodeId: bestNode.nodeId,
        port: bestNode.port,
        operation,
        streamId
      });
      
    } catch (error) {
      console.error('❌ Error selecting SFU node:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get SFU node information
  router.get('/sfu-nodes', (req, res) => {
    const nodes = metricsManager.getAllSfuNodes();
    res.json(nodes.map(([nodeId, node]) => ({
      nodeId,
      ...node
    })));
  });

  // Get stream mappings
  router.get('/stream-mappings', (req, res) => {
    const mappings = peerManager.getAllStreamMappings();
    res.json(mappings.map(([streamId, mapping]) => ({
      streamId,
      ...mapping
    })));
  });

  // Health check for signaling server
  router.get('/health', (req, res) => {
    const sfuNodes = metricsManager.getAllSfuNodes();
    const activeNodes = sfuNodes.filter(([, node]) => node.status === 'active');
    
    res.json({
      status: 'healthy',
      sfuNodes: sfuNodes.length,
      activeNodes: activeNodes.length,
      streamMappings: peerManager.getAllStreamMappings().length
    });
  });

  // Update SFU node status
  router.post('/sfu-nodes/:nodeId/status', (req, res) => {
    const { nodeId } = req.params;
    const { status, connections } = req.body;
    
    const node = metricsManager.getSfuNode(nodeId);
    if (node) {
      node.status = status;
      if (connections !== undefined) {
        node.connections = connections;
      }
      node.lastHeartbeat = Date.now();
      
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'SFU node not found' });
    }
  });

  // Remove SFU node
  router.delete('/sfu-nodes/:nodeId', (req, res) => {
    const { nodeId } = req.params;
    const removedNode = metricsManager.removeSfuNode(nodeId);
    
    if (removedNode) {
      res.json({ success: true, removedNode });
    } else {
      res.status(404).json({ error: 'SFU node not found' });
    }
  });

  return router;
};
