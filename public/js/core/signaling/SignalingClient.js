import Logger from '../../utils/Logger.js';

export default class SignalingClient {
  constructor(serverUrl) {
    this.socket = null;
    this.serverUrl = serverUrl;
    this.eventHandlers = new Map(); // event -> [handlers]
  }

  connect() {
    this.socket = io(this.serverUrl);

    this.socket.on('connect', () => {
      Logger.info('[Signaling] Connected:', this.socket.id);
      this.emitLocal('connect', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      Logger.warn('[Signaling] Disconnected:', reason);
      this.emitLocal('disconnect', reason);
    });

    this.socket.onAny((event, payload) => {
      Logger.debug(`[Signaling] Event: ${event}`, payload);
      this.emitLocal(event, payload);
    });
  }

  send(event, data) {
    if (!this.socket?.connected) {
      Logger.warn('[Signaling] Cannot send, socket not connected.');
      return;
    }
    this.socket.emit(event, data);
    Logger.debug(`[Signaling] Sent ${event}:`, data);
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emitLocal(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((cb) => cb(data));
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      Logger.info('[Signaling] Socket manually disconnected.');
    }
  }

  isConnected() {
    return this.socket?.connected ?? false;
  }
}