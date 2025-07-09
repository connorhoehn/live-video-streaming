module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { roomManager, transportManager, routerManager } = dependencies;
      const { NODE_ID } = require('../../utils/constants');
    
    // Get room statistics
    const roomStats = roomManager ? {
      rooms: roomManager.rooms.size,
      participants: Array.from(roomManager.rooms.values()).reduce(
        (sum, room) => sum + room.participants.size, 0
      ),
      producers: Array.from(roomManager.rooms.values()).reduce(
        (sum, room) => sum + Array.from(room.producers.values())
          .reduce((s, set) => s + set.size, 0), 0
      ),
      consumers: Array.from(roomManager.rooms.values()).reduce(
        (sum, room) => sum + Array.from(room.consumers.values())
          .reduce((s, set) => s + set.size, 0), 0
      )
    } : { rooms: 0, participants: 0, producers: 0, consumers: 0 };

    // Get transport statistics
    const transportStats = transportManager ? {
      webRtcTransports: transportManager.transports.size,
      pipeTransports: transportManager.pipeTransports.size,
      producers: transportManager.getProducerCount(),
      consumers: transportManager.getConsumerCount(),
    } : { 
      webRtcTransports: 0,
      pipeTransports: 0,
      producers: 0,
      consumers: 0
    };
    
    // Get router statistics
    const routerStats = routerManager ? {
      routers: routerManager.routers.size,
      workerLoad: Array.from(routerManager.workerLoadMap.values())
    } : { 
      routers: 1,
      workerLoad: [0]
    };
    
    // Calculate load
    const currentLoad = Math.min(100, 
      (transportStats.webRtcTransports * 2) + 
      (transportStats.producers * 5) +
      (transportStats.consumers * 1) +
      (roomStats.participants * 2)
    );
    
    res.json({
      nodeId: NODE_ID,
      uptime: process.uptime(),
      rooms: roomStats,
      transports: transportStats,
      routers: routerStats,
      load: currentLoad,
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
