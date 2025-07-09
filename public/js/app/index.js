import UIManager from '../core/ui/UIManager.js';
import EventBinder from '../core/ui/EventBinder.js';
import VideoLayoutManager from '../core/ui/VideoLayoutManager.js';
import ChatManager from '../core/chat/ChatManager.js';
import StreamManager from '../core/media/StreamManager.js';
import DeviceManager from '../core/transport/DeviceManager.js';
import TransportManager from '../core/transport/TransportManager.js';
import ProducerController from '../core/transport/ProducerController.js';
import ConsumerController from '../core/transport/ConsumerController.js';
import SignalingClient from '../core/signaling/SignalingClient.js';
import DebugTools from '../utils/DebugTools.js';
import StatusMonitor from '../utils/StatusMonitor.js';
import Notifications from '../utils/Notifications.js';
import Logger from '../utils/Logger.js';

// ✅ Setup core modules
const ui = new UIManager();
const videoLayout = new VideoLayoutManager();
const streamManager = new StreamManager();
const signaling = new SignalingClient('http://localhost:3000'); // adjust as needed
const status = new StatusMonitor();
const notifier = new Notifications();

const chat = new ChatManager({ uiManager: ui, signalingClient: signaling });
const deviceManager = new DeviceManager();
const transportManager = new TransportManager({ signalingClient: signaling });
const producerController = new ProducerController({
  device: deviceManager,
  transportManager,
  streamManager,
});
const consumerController = new ConsumerController({
  device: deviceManager,
  transportManager,
  streamManager,
  videoLayoutManager: videoLayout,
});

// ✅ Bind event listeners
const binder = new EventBinder(ui, {
  onJoinRoom: async () => {
    const { roomId, userType, username } = ui.getInputs();
    if (!roomId || !username) {
      notifier.show('Room ID and Username required', 'warning');
      return;
    }

    signaling.send('room:join', { roomId, userType, username });
    status.bulkUpdate({ roomId, userType, username });
  },

  onStartStream: async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      await producerController.startProducing(stream);
      videoLayout.createVideoElement({ id: 'local', stream, isLocal: true });
      signaling.send('stream:started');
      notifier.show('Streaming started', 'success');
    } catch (err) {
      Logger.error('[App] Failed to start stream', err);
      notifier.show('Failed to start stream', 'error');
    }
  },

  onStopStream: () => {
    producerController.stopAll();
    videoLayout.removeVideoElement('local');
    streamManager.stopAllStreams();
    signaling.send('stream:stopped');
    notifier.show('Streaming stopped', 'info');
  },

  onSendMessage: () => {
    const { chatMessage, username } = ui.getInputs();
    chat.sendChatMessage(username, chatMessage);
  }
});

// ✅ Socket handlers
signaling.on('connect', () => status.update('socket', 'connected'));
signaling.on('disconnect', () => status.update('socket', 'disconnected'));

signaling.on('router:rtpCapabilities', async (rtpCaps) => {
  await deviceManager.loadDevice(rtpCaps);
  signaling.send('client:capabilities', { rtpCapabilities: deviceManager.getDevice().rtpCapabilities });
});

signaling.on('stream:newProducer', async ({ peerId, producerId, rtpCapabilities }) => {
  await consumerController.createConsumer({ peerId, producerId, rtpCapabilities });
});

signaling.on('peer:left', ({ peerId }) => {
  consumerController.cleanupPeer(peerId);
});

chat.bindToSocket();

// ✅ Initialize everything
binder.bindEvents();
signaling.connect();

// ✅ Enable debug tools
const debug = new DebugTools({ videoManager: videoLayout, streamManager });
debug.expose();

Logger.info('[App] Client initialized');