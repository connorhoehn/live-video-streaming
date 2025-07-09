// Get all producers endpoint
module.exports = (dependencies) => async (req, res) => {
  try {
    const { roomManager, nodeId } = dependencies;
    
    const allProducers = [];
    
    // Get all rooms
    const rooms = roomManager.getAllRooms();
    
    // Iterate through all rooms and participants to collect producers
    for (const [roomId, room] of Object.entries(rooms)) {
      for (const [participantId, participant] of Object.entries(room.participants)) {
        for (const [producerId, producer] of Object.entries(participant.producers || {})) {
          // Only include local producers (not piped ones)
          if (!producer.isPiped) {
            allProducers.push({
              id: producerId,
              kind: producer.kind,
              participantId: participantId,
              roomId: roomId,
              streamId: `${roomId}_${participantId}`,
              streamName: `${participantId}'s stream`,
              originalProducerId: producerId,
              nodeId: nodeId
            });
          }
        }
      }
    }
    
    console.log(`📤 [PRODUCERS] Found ${allProducers.length} local producers on node ${nodeId}`);
    
    res.status(200).json(allProducers);
  } catch (error) {
    console.error(`❌ [PRODUCERS] Error getting producers:`, error);
    res.status(500).json({ error: error.message });
  }
};
