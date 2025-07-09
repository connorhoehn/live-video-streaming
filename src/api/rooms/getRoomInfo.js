module.exports = (dependencies) => {
  return (req, res) => {
    try {
      const { roomId } = req.params;
      const { roomManager } = dependencies;
    
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const participants = [];
    room.participants.forEach((participant, id) => {
      participants.push({
        id,
        metadata: participant.metadata
      });
    });
    
    res.status(200).json({
      id: room.id,
      participants,
      metadata: room.metadata,
      createdAt: room.createdAt,
      settings: room.settings
    });
  } catch (error) {
    console.error('Error getting room info:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
