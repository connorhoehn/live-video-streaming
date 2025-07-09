export default class EventBinder {
  constructor(ui, handlers = {}) {
    this.ui = ui;
    this.handlers = handlers;
  }

  bindEvents() {
    const {
      onJoinRoom,
      onStartStream,
      onStopStream,
      onSendMessage,
    } = this.handlers;

    if (this.ui.joinRoomBtn && onJoinRoom) {
      this.ui.joinRoomBtn.addEventListener('click', onJoinRoom);
    }

    if (this.ui.startStreamBtn && onStartStream) {
      this.ui.startStreamBtn.addEventListener('click', onStartStream);
    }

    if (this.ui.stopStreamBtn && onStopStream) {
      this.ui.stopStreamBtn.addEventListener('click', onStopStream);
    }

    if (this.ui.sendMessageBtn && onSendMessage) {
      this.ui.sendMessageBtn.addEventListener('click', onSendMessage);
    }

    if (this.ui.chatInput && onSendMessage) {
      this.ui.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSendMessage();
        }
      });
    }
  }
}