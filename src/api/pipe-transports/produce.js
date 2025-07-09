// Produce on pipe transport endpoint
module.exports = (transportManager, pipeTransportManager, producers) => async (req, res) => {
  try {
    const { transportId } = req.params;
    const { producerId } = req.body;
    
    if (!producerId) {
      return res.status(400).json({ error: 'Missing producerId' });
    }
    
    // Get producer
    let producer = null;
    const producerData = producers.get(producerId);
    
    if (producerData && producerData.producer) {
      producer = producerData.producer;
    } else {
      // Try to get from transport manager
      producer = await transportManager.getProducerById(producerId);
    }
    
    if (!producer) {
      return res.status(404).json({ error: 'Producer not found' });
    }
    
    // Get pipe transport from transport manager
    const pipeTransport = await transportManager.getPipeTransport(transportId);
    let pipeProducer;
    
    if (!pipeTransport) {
      // Try legacy pipe transports
      const legacyTransport = pipeTransportManager.pipeTransports.get(transportId);
      if (!legacyTransport) {
        return res.status(404).json({ error: 'Pipe transport not found' });
      }
      
      // Create producer on pipe transport
      pipeProducer = await legacyTransport.produce({ producerId });
      pipeTransportManager.pipeProducers.set(pipeProducer.id, pipeProducer);
    } else {
      // Create producer through transport manager
      pipeProducer = await transportManager.createPipeProducer(transportId, { producerId });
    }
    
    console.log(`🚇 [PIPE] Created pipe producer ${pipeProducer.id} from producer ${producerId}`);
    res.status(200).json({ id: pipeProducer.id });
  } catch (error) {
    console.error('Error creating pipe producer:', error);
    res.status(500).json({ error: error.message });
  }
};
