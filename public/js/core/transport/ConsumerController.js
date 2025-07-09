import Logger from '../../utils/Logger.js';

export default class ConsumerController {
  constructor({ device, transportManager, streamManager, videoLayoutManager }) {
    this.device = device;
    this.transportManager = transportManager;
    this.streamManager = streamManager;
    this.videoLayoutManager = videoLayoutManager;
    this.consumers = new Map(); // peerId -> consumer
  }

  async createConsumer({ peerId, producerId, rtpCapabilities }) {
    if (!this.device.canProduce('video')) {
      Logger.warn('Device cannot consume video.');
      return;
    }

    const consumerTransport = this.transportManager.getConsumerTransport();
    const { consumer, stream } = await this.transportManager.consume({
      transport: consumerTransport,
      producerId,
      rtpCapabilities
    });

    this.consumers.set(peerId, consumer);
    this.streamManager.addPeerStream(peerId, stream);
    this.videoLayoutManager.createVideoElement({
      id: `remote-${peerId}`,
      stream,
      isLocal: false
    });

    consumer.on('transportclose', () => {
      Logger.warn(`[Consumer] Transport closed for ${peerId}`);
      this.cleanupPeer(peerId);
    });

    consumer.on('producerclose', () => {
      Logger.warn(`[Consumer] Producer closed for ${peerId}`);
      this.cleanupPeer(peerId);
    });

    return consumer;
  }

  cleanupPeer(peerId) {
    const consumer = this.consumers.get(peerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(peerId);
    }
    this.streamManager.removePeerStream(peerId);
    this.videoLayoutManager.removeVideoElement(`remote-${peerId}`);
  }

  cleanupAll() {
    this.consumers.forEach((_, peerId) => this.cleanupPeer(peerId));
  }
}