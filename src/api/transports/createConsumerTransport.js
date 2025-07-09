module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { roomId, participantId } = req.body;
      const { transportManager, roomManager } = dependencies;
    
    // Validate room and participant if provided
    if (roomId) {
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      
      if (participantId) {
        const participant = roomManager.getParticipant(roomId, participantId);
        if (!participant) {
          return res.status(404).json({ error: 'Participant not found in room' });
        }
      }
    }
    
    // Create consumer transport
    const transportData = await transportManager.createConsumerTransport();
    
    // If room and participant are provided, track this transport in the room
    if (roomId && participantId) {
      roomManager.addTransportToParticipant(roomId, participantId, transportData.id, 'consumer');
    }
    
    console.log(`🚛 [TRANSPORT] Created consumer transport: ${transportData.id}`);
    
    res.json({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters
    });
  } catch (error) {
    console.error('Error creating consumer transport:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
