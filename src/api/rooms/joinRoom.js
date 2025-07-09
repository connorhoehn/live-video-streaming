module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { roomId, participantId, metadata } = req.body;
      const { roomManager, routerManager, router } = dependencies;
      
      if (!roomId) {
        return res.status(400).json({ error: 'roomId is required' });
      }
    
    if (!participantId) {
      return res.status(400).json({ error: 'participantId is required' });
    }
    
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    await roomManager.joinRoom(roomId, participantId, { metadata });
    
    const routerId = roomManager.getRoomRouterId(roomId);
    const currentRouter = routerManager.getRouter(routerId) || router;
    
    if (!currentRouter) {
      return res.status(500).json({ error: 'Router not found for room' });
    }
    
    console.log(`👤 Participant ${participantId} joined room ${roomId}`);
    
    res.status(200).json({
      roomId,
      routerId,
      rtpCapabilities: currentRouter.rtpCapabilities
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
