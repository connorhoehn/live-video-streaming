module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { roomId } = req.params;
      const { roomManager } = dependencies;
    
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    await roomManager.closeRoom(roomId);
    
    console.log(`🏠 Room deleted: ${roomId}`);
    
    res.status(200).json({ message: 'Room closed successfully' });
  } catch (error) {
    console.error('Error closing room:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
