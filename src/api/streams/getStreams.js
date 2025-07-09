// Get streams endpoint
module.exports = (dependencies) => (req, res) => {
  try {
    const { streamManager, roomManager, nodeId } = dependencies;
    
    let streamList = [];
    
    // Get streams from stream manager if available
    if (streamManager && streamManager.getAllStreams) {
      const streams = streamManager.getAllStreams();
      streamList = Array.from(streams.values()).map(stream => ({
        id: stream.id,
        name: stream.name,
        roomId: stream.roomId,
        participantId: stream.participantId,
        hasAudio: stream.producers.has('audio'),
        hasVideo: stream.producers.has('video'),
        audioProducerId: stream.producers.get('audio')?.id,
        videoProducerId: stream.producers.get('video')?.id,
        active: stream.active,
        createdAt: stream.createdAt,
        nodeId: nodeId // Add node information
      }));
    }
    
    // Also get producers from room manager and convert to stream format
    if (roomManager) {
      const rooms = roomManager.getAllRooms();
      
      Object.values(rooms).forEach(room => {
        // Convert participants Map to entries for iteration
        const participantEntries = room.participants instanceof Map ? 
          Array.from(room.participants.entries()) : 
          Object.entries(room.participants);
          
        participantEntries.forEach(([participantId, participant]) => {
          if (participant.producers && participant.producers.size > 0) {
            // Check if we already have this stream
            const existingStream = streamList.find(s => 
              s.participantId === participantId && s.roomId === room.id
            );
            
            if (!existingStream) {
              // Create stream from producers
              const producers = Array.from(participant.producers.entries());
              const hasVideo = producers.some(([id, producer]) => producer.kind === 'video');
              const hasAudio = producers.some(([id, producer]) => producer.kind === 'audio');
              
              const videoProducer = producers.find(([id, producer]) => producer.kind === 'video');
              const audioProducer = producers.find(([id, producer]) => producer.kind === 'audio');
              
              streamList.push({
                id: `${room.id}_${participantId}`,
                name: `${participantId}'s stream`,
                roomId: room.id,
                participantId: participantId,
                hasAudio: hasAudio,
                hasVideo: hasVideo,
                audioProducerId: audioProducer ? audioProducer[0] : null,
                videoProducerId: videoProducer ? videoProducer[0] : null,
                active: true,
                createdAt: new Date().toISOString(),
                nodeId: nodeId, // Add node information
                producers: producers.map(([id, producer]) => ({
                  id: id,
                  kind: producer.kind
                }))
              });
            }
          }
        });
      });
    }
    
    console.log(`📊 [API] Returning ${streamList.length} streams from node ${nodeId}`);
    res.json(streamList);
  } catch (error) {
    console.error('Error getting streams:', error);
    res.status(500).json({ error: error.message });
  }
};
