// Create pipe transport endpoint
module.exports = (transportManager, routerManager) => async (req, res) => {
  try {
    const { targetNodeId, routerId } = req.body;
    
    // Get router or use default
    const targetRouter = routerId ? 
      routerManager.getRouter(routerId) : 
      routerManager.getDefaultRouter();
    
    if (!targetRouter) {
      return res.status(404).json({ error: 'Router not found' });
    }
    
    // Create pipe transport
    const pipeTransportInfo = await transportManager.createPipeTransport({
      router: targetRouter
    });

    console.log(`🚇 [PIPE] Created pipe transport ${pipeTransportInfo.id} for router ${targetRouter.id}`);
    
    res.status(200).json({
      id: pipeTransportInfo.id,
      ip: pipeTransportInfo.ip,
      port: pipeTransportInfo.port,
      srtpParameters: pipeTransportInfo.srtpParameters
    });
  } catch (error) {
    console.error('Error creating pipe transport:', error);
    res.status(500).json({ error: error.message });
  }
};