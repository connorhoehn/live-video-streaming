export default class UIManager {
  constructor() {
    this.statusEl = document.getElementById('status');
    this.roomIdInput = document.getElementById('roomId');
    this.userTypeSelect = document.getElementById('userType');
    this.usernameInput = document.getElementById('username');
    this.joinRoomBtn = document.getElementById('joinRoom');
    this.startStreamBtn = document.getElementById('startStream');
    this.stopStreamBtn = document.getElementById('stopStream');
    this.chatInput = document.getElementById('chatInput');
    this.sendMessageBtn = document.getElementById('sendMessage');
    this.chatMessages = document.getElementById('chatMessages');
    this.roomInfo = document.getElementById('roomInfo');
    this.roomIdDisplay = document.getElementById('roomIdDisplay');
    this.userTypeDisplay = document.getElementById('userTypeDisplay');
    this.streamerVideoSection = document.getElementById('streamerVideoSection');
    this.viewerVideoSection = document.getElementById('viewerVideoSection');
  }

  updateStatus(message) {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }

  updateRoomInfo(roomId, userType) {
    if (this.roomInfo) {
      this.roomIdDisplay.textContent = roomId;
      this.userTypeDisplay.textContent = userType;
      this.roomInfo.style.display = 'block';
    }
  }

  updateUIForUserType(userType) {
    if (!this.streamerVideoSection || !this.viewerVideoSection) return;

    if (userType === 'streamer') {
      this.streamerVideoSection.style.display = 'block';
      this.viewerVideoSection.style.display = 'none';
    } else if (userType === 'viewer') {
      this.streamerVideoSection.style.display = 'none';
      this.viewerVideoSection.style.display = 'block';
    } else {
      this.streamerVideoSection.style.display = 'none';
      this.viewerVideoSection.style.display = 'none';
    }
  }

  enableControls(enabled = true) {
    const buttons = [
      this.joinRoomBtn,
      this.startStreamBtn,
      this.stopStreamBtn,
      this.sendMessageBtn
    ];

    buttons.forEach((btn) => {
      if (btn) btn.disabled = !enabled;
    });
  }

  appendChatMessage(sender, message) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.textContent = `${sender}: ${message}`;
    if (this.chatMessages) this.chatMessages.appendChild(msgEl);
  }

  getInputs() {
    return {
      roomId: this.roomIdInput?.value || '',
      userType: this.userTypeSelect?.value || '',
      username: this.usernameInput?.value || '',
      chatMessage: this.chatInput?.value || '',
    };
  }

  clearChatInput() {
    if (this.chatInput) this.chatInput.value = '';
  }
}