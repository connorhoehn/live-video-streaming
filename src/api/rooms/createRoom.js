module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { metadata, settings } = req.body;
      const { roomManager, router } = dependencies;
    
    const room = await roomManager.createRoom({
      metadata,
      settings,
      ...req.body
    });
    
    // Assign router to room
    const routerId = router.id;
    await roomManager.setRoomRouter(room.id, routerId);
    
    console.log(`🏠 Room created: ${room.id}`);
    
    res.status(201).json({
      roomId: room.id,
      router: {
        id: routerId,
        rtpCapabilities: router.rtpCapabilities
      }
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
