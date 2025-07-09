import Logger from '../../utils/Logger.js';

export default class ProducerController {
  constructor({ device, transportManager, streamManager }) {
    this.device = device;
    this.transportManager = transportManager;
    this.streamManager = streamManager;
    this.producers = new Map(); // kind -> producer
  }

  async startProducing(localStream) {
    const transport = this.transportManager.getProducerTransport();
    const tracks = {
      video: localStream.getVideoTracks()[0],
      audio: localStream.getAudioTracks()[0],
    };

    for (const kind of ['video', 'audio']) {
      const track = tracks[kind];
      if (track && this.device.canProduce(kind)) {
        try {
          const producer = await transport.produce({ track });
          this.producers.set(kind, producer);

          producer.on('trackended', () => {
            Logger.warn(`[Producer] ${kind} track ended`);
            this.stopProducer(kind);
          });

          producer.on('transportclose', () => {
            Logger.warn(`[Producer] ${kind} transport closed`);
            this.producers.delete(kind);
          });

          Logger.info(`[Producer] ${kind} started`);
        } catch (err) {
          Logger.error(`[Producer] Failed to produce ${kind}:`, err);
        }
      }
    }

    this.streamManager.setLocalStream(localStream);
  }

  stopProducer(kind) {
    const producer = this.producers.get(kind);
    if (producer) {
      producer.close();
      this.producers.delete(kind);
      Logger.info(`[Producer] ${kind} stopped`);
    }
  }

  stopAll() {
    for (const kind of this.producers.keys()) {
      this.stopProducer(kind);
    }
  }

  getProducer(kind) {
    return this.producers.get(kind);
  }
}