import Logger from '../../utils/Logger.js';

export default class StreamManager {
  constructor() {
    this.localStream = null;
    this.peerStreams = new Map(); // peerId -> MediaStream
  }

  setLocalStream(stream) {
    this.localStream = stream;
    Logger.info('[StreamManager] Local stream set');
  }

  getLocalStream() {
    return this.localStream;
  }

  addPeerStream(peerId, stream) {
    this.peerStreams.set(peerId, stream);
    Logger.info(`[StreamManager] Added stream for ${peerId}`);
  }

  removePeerStream(peerId) {
    this.peerStreams.delete(peerId);
    Logger.info(`[StreamManager] Removed stream for ${peerId}`);
  }

  getPeerStream(peerId) {
    return this.peerStreams.get(peerId);
  }

  getPeerStreamMap() {
    return Object.fromEntries(this.peerStreams.entries());
  }

  stopAllStreams() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      Logger.info('[StreamManager] Stopped local stream');
    }

    this.peerStreams.forEach((stream, peerId) => {
      stream.getTracks().forEach((track) => track.stop());
      Logger.info(`[StreamManager] Stopped stream for ${peerId}`);
    });

    this.peerStreams.clear();
  }
}