// Create stream endpoint
module.exports = (streams, metricsManager) => async (req, res) => {
  try {
    const { streamName } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const stream = {
      id: streamId,
      name: streamName || `Stream ${streams.size + 1}`,
      clientIp,
      createdAt: new Date(),
      producers: new Map(), // audio and video producers
      active: true
    };
    
    streams.set(streamId, stream);
    
    // Track stream creation in mesh
    metricsManager.trackStreamActivity(streamId, 'create', {
      streamName: stream.name,
      clientIp: clientIp
    });
    
    console.log(`🎬 [STREAM CREATE] New stream created:`);
    console.log(`  📺 Stream ID: ${streamId}`);
    console.log(`  📝 Name: ${stream.name}`);
    console.log(`  🌐 Client IP: ${clientIp}`);
    console.log(`  🏠 SFU Node: ${metricsManager.nodeId}`);
    
    res.json({ 
      streamId: streamId,
      name: stream.name
    });
  } catch (error) {
    console.error('Error creating stream:', error);
    res.status(500).json({ error: error.message });
  }
};
