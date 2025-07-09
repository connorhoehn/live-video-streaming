import Logger from '../../utils/Logger.js';

export default class ChatManager {
  constructor({ uiManager, signalingClient }) {
    this.ui = uiManager;
    this.signaling = signalingClient;
  }

  sendChatMessage(username, message) {
    if (!message || !username) return;
    this.signaling.send('chat:message', { username, message });
    this.ui.appendChatMessage(username, message);
    this.ui.clearChatInput();
    Logger.info('[Chat] Message sent:', message);
  }

  handleIncomingChat({ username, message }) {
    this.ui.appendChatMessage(username, message);
    Logger.debug('[Chat] Message received:', { username, message });
  }

  bindToSocket() {
    this.signaling.on('chat:message', (data) => this.handleIncomingChat(data));
  }
}