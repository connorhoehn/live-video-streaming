module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { transportId } = req.body;
      const { dtlsParameters } = req.body;
    const { transportManager } = dependencies;
    
    // Validate DTLS parameters
    if (!dtlsParameters || !dtlsParameters.fingerprints || dtlsParameters.fingerprints.length === 0) {
      return res.status(400).json({ error: 'Invalid DTLS parameters' });
    }
    
    // Get transport from manager
    const transportInfo = transportManager.getTransport(transportId);
    if (!transportInfo) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    
    console.log(`🔐 [TRANSPORT CONNECT] Connecting transport ${transportId}`);
    console.log('🔐 [TRANSPORT CONNECT] DTLS parameters:', dtlsParameters);
    await transportManager.connectTransport(transportId, dtlsParameters);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error connecting transport:', error);
    res.status(500).json({ error: error.message });
  }
  };
};
