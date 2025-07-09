module.exports = (dependencies) => {
  return async (req, res) => {
    try {
      const { transportId, producerId, rtpCapabilities, roomId, participantId } = req.body;
      const { transportManager, roomManager, router } = dependencies;

      if (!producerId || !rtpCapabilities) {
        return res.status(400).json({ error: 'Missing producerId or rtpCapabilities' });
      }

      let actualProducer = await transportManager.getProducerById(producerId);

      if (!actualProducer) {
        console.warn(`⚠️ Producer ${producerId} not found locally. Checking pipe consumers...`);
        const pipeConsumer = await transportManager.getPipeConsumerByOriginalProducerId?.(producerId);
        if (!pipeConsumer) {
          return res.status(404).json({ error: 'Producer not found locally or piped' });
        }

        actualProducer = await transportManager.getProducerById(pipeConsumer.producerId);
        if (!actualProducer) {
          return res.status(404).json({ error: 'Mirrored producer not found for piped consumer' });
        }
      }

      const canConsume = router.canConsume({
        producerId: actualProducer.id,
        rtpCapabilities
      });

      if (!canConsume) {
        return res.status(400).json({ error: 'Cannot consume producer with given RTP capabilities' });
      }

      const consumer = await transportManager.createConsumer(transportId, {
        producerId: actualProducer.id,
        rtpCapabilities,
        paused: true
      });

      if (roomId && participantId) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          await roomManager.addConsumerToParticipant(roomId, participantId, consumer.id, {
            producerId: actualProducer.id,
            kind: consumer.kind
          });
        }
      }

      console.log(`📥 [CONSUME] Consumer created: ${consumer.id} (for producer ${actualProducer.id})`);

      res.status(200).json({
        id: consumer.id,
        producerId: actualProducer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused
      });
    } catch (error) {
      console.error('❌ Error creating consumer:', error);
      res.status(500).json({ error: error.message });
    }
  };
};