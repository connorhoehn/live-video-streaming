// Cluster Coordinator API routes
const express = require('express');
const router = express.Router();

module.exports = (coordinator) => {
  // Node management APIs
  router.post('/nodes/register', (req, res) => {
    const { nodeId, host, port, capacity } = req.body;
    const result = coordinator.registerNode(nodeId, { host, port, capacity });
    res.json(result);
  });

  router.post('/nodes/:nodeId/stats', (req, res) => {
    const { nodeId } = req.params;
    const result = coordinator.updateNodeStats(nodeId, req.body);
    res.json(result);
  });

  router.get('/nodes', (req, res) => {
    const nodes = coordinator.getNodes();
    res.json(nodes);
  });

  // Room management APIs
  router.post('/rooms/assign', (req, res) => {
    const { roomId } = req.body;
    const result = coordinator.assignRoom(roomId);
    res.json(result);
  });

  router.get('/rooms/:roomId/node', (req, res) => {
    const { roomId } = req.params;
    const result = coordinator.getRoomNode(roomId);
    res.json(result);
  });

  router.delete('/rooms/:roomId', (req, res) => {
    const { roomId } = req.params;
    const result = coordinator.deleteRoom(roomId);
    res.json(result);
  });

  // Visualization endpoints
  router.get('/visualization', (req, res) => {
    const data = coordinator.getVisualizationData();
    res.json(data);
  });

  router.get('/routers', (req, res) => {
    const routers = coordinator.getAllRouters();
    res.json(routers);
  });

  router.get('/streams', (req, res) => {
    const streams = coordinator.getAllStreamRoutes();
    res.json(streams);
  });

  router.get('/pipes', (req, res) => {
    const pipes = coordinator.getAllPipeConnections();
    res.json(pipes);
  });

  router.get('/health', (req, res) => {
    const health = coordinator.getHealthStatus();
    res.json(health);
  });

  return router;
};
