import Logger from '../../utils/Logger.js';
import * as mediasoupClient from 'mediasoup-client';

export default class DeviceManager {
  constructor() {
    this.device = null;
  }

  async loadDevice(rtpCapabilities) {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      Logger.info('[Device] Loaded RTP Capabilities.');
    } catch (err) {
      Logger.error('[Device] Failed to load:', err);
      throw err;
    }
  }

  getDevice() {
    return this.device;
  }

  canProduce(kind) {
    return this.device?.canProduce(kind) ?? false;
  }
}