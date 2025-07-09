// Connect pipe transport endpoint
module.exports = (transportManager, pipeTransportManager) => async (req, res) => {
  try {
    const { transportId } = req.params;
    const { ip, port, srtpParameters } = req.body;
    
    // Get pipe transport from transport manager
    const pipeTransport = await transportManager.getPipeTransport(transportId);
    
    if (!pipeTransport) {
      // Try legacy pipe transports
      const legacyTransport = pipeTransportManager.pipeTransports.get(transportId);
      if (!legacyTransport) {
        return res.status(404).json({ error: 'Pipe transport not found' });
      }
      
      // Connect legacy pipe transport
      await legacyTransport.connect({ ip, port, srtpParameters });
    } else {
      // Connect pipe transport through manager
      await transportManager.connectPipeTransport(transportId, { ip, port, srtpParameters });
    }
    
    console.log(`🚇 [PIPE] Connected pipe transport ${transportId} to ${ip}:${port}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error connecting pipe transport:', error);
    res.status(500).json({ error: error.message });
  }
};
