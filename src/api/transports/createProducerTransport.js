// Create producer transport endpoint
module.exports = ({ transportManager, roomManager }) => async (req, res) => {
  try {
    const { roomId, participantId } = req.body;
    
    // Validate room and participant
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
    
    // Create producer transport
    const transportData = await transportManager.createProducerTransport();
    
    // If room and participant are provided, track this transport in the room
    if (roomId && participantId) {
      roomManager.addTransportToParticipant(roomId, participantId, transportData.id, 'producer');
    }
    
    console.log(`🚛 [TRANSPORT] Created producer transport: ${transportData.id}`);
    
    res.json({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters
    });
  } catch (error) {
    console.error('Error creating producer transport:', error);
    res.status(500).json({ error: error.message });
  }
};
