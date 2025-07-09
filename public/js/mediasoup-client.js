class MediasoupClient {
  constructor() {
    console.log('🚀 [INIT] MediasoupClient constructor started');
    this.socket = null;
    this.device = null;
    this.routerRtpCapabilities = null;
    this.producerTransport = null;
    this.consumerTransport = null;
    this.consumerTransportCreating = false; // Add lock for transport creation
    this.producer = null;
    this.consumers = new Map(); // consumerId -> consumer
    this.localStream = null;
    this.roomId = null;
    this.userType = null;
    this.username = null;
    this.connectedNodeId = null;
    this.connectedNodeInfo = null;
    
    // Track producers and consumers by peer
    this.peerProducers = new Map(); // socketId -> { video?: producerId, audio?: producerId }
    this.peerStreams = new Map(); // socketId -> MediaStream
    this.peerTracks = new Map(); // socketId -> { video?: track, audio?: track }
    this.layoutUpdateTimeouts = new Map(); // socketId -> timeout
    
    console.log('🚀 [INIT] Initializing elements...');
    this.initElements();
    console.log('🚀 [INIT] Setting up event listeners...');
    this.setupEventListeners();
    console.log('🚀 [INIT] Connecting to server...');
    this.connect();
    console.log('🚀 [INIT] MediasoupClient constructor completed');
  }

  initElements() {
    console.log('🔍 [INIT] Starting element initialization...');
    
    // UI Elements
    this.statusEl = document.getElementById('status');
    console.log('🔍 [INIT] statusEl:', this.statusEl);
    
    this.roomIdInput = document.getElementById('roomId');
    console.log('🔍 [INIT] roomIdInput:', this.roomIdInput);
    
    this.userTypeSelect = document.getElementById('userType');
    console.log('🔍 [INIT] userTypeSelect:', this.userTypeSelect);
    
    this.usernameInput = document.getElementById('username');
    console.log('🔍 [INIT] usernameInput:', this.usernameInput);
    
    this.joinRoomBtn = document.getElementById('joinRoom');
    console.log('🔍 [INIT] joinRoomBtn:', this.joinRoomBtn);
    
    this.startStreamBtn = document.getElementById('startStream');
    console.log('🔍 [INIT] startStreamBtn:', this.startStreamBtn);
    
    this.stopStreamBtn = document.getElementById('stopStream');
    console.log('🔍 [INIT] stopStreamBtn:', this.stopStreamBtn);
    
    // Video elements - using dynamic layout like app.js
    this.streamerVideoSection = document.getElementById('remoteVideos'); // Use the remoteVideos section for all videos
    console.log('🔍 [INIT] streamerVideoSection:', this.streamerVideoSection);
    
    this.localVideo = null; // Will be created dynamically
    this.remoteStreams = new Map(); // peerId -> MediaStream
    this.activeStreamers = new Set(); // Track who is actively streaming
    
    // Info elements
    this.currentRoomEl = document.getElementById('currentRoom');
    console.log('🔍 [INIT] currentRoomEl:', this.currentRoomEl);
    
    this.streamerCountEl = document.getElementById('streamerCount');
    console.log('🔍 [INIT] streamerCountEl:', this.streamerCountEl);
    
    this.viewerCountEl = document.getElementById('viewerCount');
    console.log('🔍 [INIT] viewerCountEl:', this.viewerCountEl);
    
    this.yourRoleEl = document.getElementById('yourRole');
    console.log('🔍 [INIT] yourRoleEl:', this.yourRoleEl);
    
    this.connectedNodeEl = document.getElementById('connectedNode');
    console.log('🔍 [INIT] connectedNodeEl:', this.connectedNodeEl);
    
    // Chat elements
    this.chatMessages = document.getElementById('chatMessages');
    console.log('🔍 [INIT] chatMessages:', this.chatMessages);
    
    this.chatInput = document.getElementById('chatInput');
    console.log('🔍 [INIT] chatInput:', this.chatInput);
    
    this.sendMessageBtn = document.getElementById('sendMessage');
    console.log('🔍 [INIT] sendMessageBtn:', this.sendMessageBtn);
    
    console.log('✅ [INIT] Element initialization completed');
  }

  setupEventListeners() {
    console.log('🎧 [EVENTS] Setting up event listeners...');
    
    if (this.joinRoomBtn) {
      this.joinRoomBtn.addEventListener('click', () => {
        console.log('🎧 [EVENTS] Join room button clicked');
        this.joinRoom();
      });
      console.log('🎧 [EVENTS] Join room listener added');
    } else {
      console.error('❌ [EVENTS] joinRoomBtn not found!');
    }
    
    if (this.startStreamBtn) {
      this.startStreamBtn.addEventListener('click', () => {
        console.log('🎧 [EVENTS] Start stream button clicked');
        this.startStream();
      });
      console.log('🎧 [EVENTS] Start stream listener added');
    } else {
      console.error('❌ [EVENTS] startStreamBtn not found!');
    }
    
    if (this.stopStreamBtn) {
      this.stopStreamBtn.addEventListener('click', () => {
        console.log('🎧 [EVENTS] Stop stream button clicked');
        this.stopStream();
      });
      console.log('🎧 [EVENTS] Stop stream listener added');
    } else {
      console.error('❌ [EVENTS] stopStreamBtn not found!');
    }
    
    if (this.sendMessageBtn) {
      this.sendMessageBtn.addEventListener('click', () => {
        console.log('🎧 [EVENTS] Send message button clicked');
        this.sendMessage();
      });
      console.log('🎧 [EVENTS] Send message listener added');
    } else {
      console.error('❌ [EVENTS] sendMessageBtn not found!');
    }
    
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          console.log('🎧 [EVENTS] Enter key pressed in chat');
          this.sendMessage();
        }
      });
      console.log('🎧 [EVENTS] Chat input keypress listener added');
    } else {
      console.error('❌ [EVENTS] chatInput not found!');
    }

    if (this.userTypeSelect) {
      this.userTypeSelect.addEventListener('change', () => {
        console.log('🎧 [EVENTS] User type changed to:', this.userTypeSelect.value);
        this.updateUIForUserType();
      });
      console.log('🎧 [EVENTS] User type change listener added');
    } else {
      console.error('❌ [EVENTS] userTypeSelect not found!');
    }
    
    console.log('✅ [EVENTS] Event listeners setup completed');
  }

  connect() {
    // Connect directly to SFU node (simpler architecture)
    this.socket = io('http://localhost:3001');
    
    this.socket.on('connect', () => {
      this.updateStatus('Connected to SFU Node', true);
      console.log('Connected to SFU Node');
      
      // Test if server is responsive
      this.socket.emit('ping', { test: true });
    });

    this.socket.on('pong', (data) => {
      console.log('✅ [PING] Server responded to ping:', data);
    });

    this.socket.on('disconnect', () => {
      this.updateStatus('Disconnected', false);
      console.log('Disconnected from signaling server');
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.updateStatus('Error: ' + (error.message || error), false);
    });

    this.socket.on('join-room-error', (error) => {
      console.error('❌ [JOIN] Join room error:', error);
      alert('Error joining room: ' + (error.message || error));
      
      // Re-enable join button
      if (this.joinRoomBtn) {
        this.joinRoomBtn.disabled = false;
      }
    });

    this.socket.on('room-joined', async (data) => {
      console.log('Joined room:', data);
      this.roomId = data.roomId;
      this.connectedNodeId = data.nodeId;
      this.connectedNodeInfo = data.nodeInfo;
      
      // Store node information for display
      console.log(`✅ [NODE] Connected to SFU node: ${this.connectedNodeId}`);
      if (this.connectedNodeInfo) {
        console.log(`✅ [NODE] Node details:`, this.connectedNodeInfo);
      }
      
      // Load MediaSoup device with the router capabilities from the server
      if (data.routerRtpCapabilities) {
        try {
          console.log('Loading device with router capabilities from room-joined event...');
          await this.loadDeviceWithCapabilities(data.routerRtpCapabilities);
          console.log('✅ [JOIN] MediaSoup device loaded successfully');
          
          this.updateRoomInfo(data);
          this.enableControls();
          
          // Check if there are existing producers in the room
          console.log('🔍 [JOIN] Checking for existing producers in room...');
          this.socket.emit('get-producers', {
            roomId: this.roomId,
            participantId: this.username
          });
        } catch (error) {
          console.error('❌ [JOIN] Error loading device:', error);
          alert('Error loading device: ' + error.message);
        }
      } else {
        console.error('❌ [JOIN] No router RTP capabilities provided');
        alert('Error: No router capabilities provided by server');
      }
    });

    this.socket.on('room-updated', (data) => {
      console.log('Room updated:', data);
      this.updateRoomInfo(data);
    });

    this.socket.on('participant-joined', (data) => {
      console.log('Participant joined:', data);
      const username = data.metadata?.username || data.participantId || (data.socketId ? data.socketId.substring(0, 8) + '...' : 'Unknown');
      this.addChatMessage(`${username} joined as ${data.type || 'participant'}`, 'system');
    });

    this.socket.on('participant-left', (data) => {
      console.log('Participant left:', data);
      this.addChatMessage(`${data.socketId.substring(0, 8)}... left`, 'system');
    });

    this.socket.on('new-producer', async (data) => {
      console.log('🎥 [CONSUME] New producer available:', data);
      console.log('🎥 [CONSUME] Current user type:', this.userType);
      console.log('🎥 [CONSUME] Device ready:', !!this.device);
      
      if (this.userType === 'viewer') {
        console.log('🎥 [CONSUME] User is viewer, starting consume flow...');
        
        // Track producer by peer
        const { producerId, participantId, kind } = data;
        if (!this.peerProducers.has(participantId)) {
          this.peerProducers.set(participantId, {});
        }
        this.peerProducers.get(participantId)[kind] = producerId;
        
        console.log('🎥 [CONSUME] Updated peer producers:', this.peerProducers.get(participantId));
        
        await this.consumeStream(producerId, participantId, kind);
      } else {
        console.log('🎥 [CONSUME] User is not viewer, ignoring producer. User type:', this.userType);
      }
    });

    this.socket.on('producer-closed', (data) => {
      console.log('Producer closed:', data);
      // Remove from our stream management using participantId instead of socketId
      const { producerId, participantId } = data;
      
      if (participantId) {
        // Clear any pending layout updates
        const timeout = this.layoutUpdateTimeouts.get(participantId);
        if (timeout) {
          clearTimeout(timeout);
          this.layoutUpdateTimeouts.delete(participantId);
        }
        
        this.remoteStreams.delete(participantId);
        this.activeStreamers.delete(participantId);
        this.peerStreams.delete(participantId);
        this.peerTracks.delete(participantId);
        this.peerProducers.delete(participantId);
        
        // Rebuild layout to remove the stream
        this.rebuildVideoLayout();
        
        this.addChatMessage(`Stream ended for ${participantId}`, 'system');
      }
    });

    this.socket.on('chat-message', (data) => {
      this.addChatMessage(`${data.socketId.substring(0, 8)}...: ${data.message}`, 'remote');
    });

    // Handle producers list response
    this.socket.on('producers', (data) => {
      console.log('🔍 [JOIN] Received producers list:', data);
      if (data && data.producers && data.producers.length > 0) {
        console.log('🔍 [JOIN] Found', data.producers.length, 'existing producers');
        data.producers.forEach(producer => {
          console.log('🔍 [JOIN] Existing producer:', producer);
          // Trigger consume for existing producers
          if (this.userType === 'viewer') {
            this.consumeStream(producer.id, producer.participantId, producer.kind);
          }
        });
      } else {
        console.log('🔍 [JOIN] No existing producers found');
      }
    });
  }

  updateStatus(message, connected) {
    console.log('📊 [STATUS] updateStatus called with:', message, 'connected:', connected);
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.className = `status ${connected ? 'connected' : 'disconnected'}`;
      console.log('📊 [STATUS] Status updated successfully');
    } else {
      console.error('❌ [STATUS] statusEl not found');
    }
  }

  updateRoomInfo(data) {
    console.log('🏠 [ROOM] updateRoomInfo called with data:', data);
    
    if (this.currentRoomEl) {
      this.currentRoomEl.textContent = data.roomId || this.roomId || '-';
      console.log('🏠 [ROOM] Current room updated to:', data.roomId || this.roomId);
    } else {
      console.error('❌ [ROOM] currentRoomEl not found');
    }
    
    if (this.yourRoleEl) {
      this.yourRoleEl.textContent = this.userType || '-';
      console.log('🏠 [ROOM] Your role updated to:', this.userType);
    } else {
      console.error('❌ [ROOM] yourRoleEl not found');
    }
    
    if (this.connectedNodeEl) {
      this.connectedNodeEl.textContent = this.connectedNodeId || '-';
      console.log('🏠 [ROOM] Connected node updated to:', this.connectedNodeId);
    } else {
      console.error('❌ [ROOM] connectedNodeEl not found');
    }
    
    // Update counts if available
    if (data.streamers !== undefined) {
      if (this.streamerCountEl) {
        this.streamerCountEl.textContent = data.streamers.length || 0;
        console.log('🏠 [ROOM] Streamer count updated to:', data.streamers.length || 0);
      } else {
        console.error('❌ [ROOM] streamerCountEl not found');
      }
    }
    if (data.viewers !== undefined) {
      if (this.viewerCountEl) {
        this.viewerCountEl.textContent = data.viewers.length || 0;
        console.log('🏠 [ROOM] Viewer count updated to:', data.viewers.length || 0);
      } else {
        console.error('❌ [ROOM] viewerCountEl not found');
      }
    }
  }

  updateUIForUserType() {
    console.log('🎨 [UI] updateUIForUserType called');
    const isStreamer = this.userType === 'streamer';
    console.log('🎨 [UI] Current user type:', this.userType, 'isStreamer:', isStreamer);
    
    if (this.startStreamBtn) {
      this.startStreamBtn.style.display = isStreamer ? 'block' : 'none';
      console.log('🎨 [UI] Start stream button display set to:', isStreamer ? 'block' : 'none');
    } else {
      console.error('❌ [UI] startStreamBtn not found in updateUIForUserType');
    }
    
    if (this.stopStreamBtn) {
      this.stopStreamBtn.style.display = isStreamer ? 'block' : 'none';
      console.log('🎨 [UI] Stop stream button display set to:', isStreamer ? 'block' : 'none');
    } else {
      console.error('❌ [UI] stopStreamBtn not found in updateUIForUserType');
    }
  }

  enableControls() {
    console.log('🔓 [CONTROLS] enableControls called');
    
    if (this.chatInput) {
      this.chatInput.disabled = false;
      console.log('🔓 [CONTROLS] Chat input enabled');
    } else {
      console.error('❌ [CONTROLS] chatInput not found');
    }
    
    if (this.sendMessageBtn) {
      this.sendMessageBtn.disabled = false;
      console.log('🔓 [CONTROLS] Send message button enabled');
    } else {
      console.error('❌ [CONTROLS] sendMessageBtn not found');
    }
    
    console.log('🔓 [CONTROLS] Current user type:', this.userType);
    if (this.userType === 'streamer') {
      if (this.startStreamBtn) {
        this.startStreamBtn.disabled = false;
        console.log('🔓 [CONTROLS] Start stream button enabled for streamer');
      } else {
        console.error('❌ [CONTROLS] startStreamBtn not found for streamer');
      }
    } else {
      console.log('🔓 [CONTROLS] User is not a streamer, stream buttons not enabled');
    }
  }

  async joinRoom() {
    console.log('🏠 [JOIN] joinRoom method called');
    
    const roomId = this.roomIdInput ? this.roomIdInput.value.trim() : '';
    const userType = this.userTypeSelect ? this.userTypeSelect.value : '';
    const username = this.usernameInput ? this.usernameInput.value.trim() || 'Anonymous' : 'Anonymous';
    
    console.log('🏠 [JOIN] Room ID:', roomId);
    console.log('🏠 [JOIN] User type:', userType);
    console.log('🏠 [JOIN] Username:', username);
    
    if (!roomId) {
      console.error('❌ [JOIN] No room ID provided');
      alert('Please enter a room ID');
      return;
    }

    if (!this.socket) {
      console.error('❌ [JOIN] Socket not connected');
      alert('Not connected to server');
      return;
    }

    this.userType = userType;
    this.username = username;
    console.log('🏠 [JOIN] Set userType to:', this.userType);
    console.log('🏠 [JOIN] Set username to:', this.username);
    
    try {
      console.log('🏠 [JOIN] Emitting join-room event...');
      // Join room through signaling server - device will be loaded when room-joined event is received
      this.socket.emit('join-room', {
        roomId,
        participantId: username,
        displayName: username
      });

      if (this.joinRoomBtn) {
        this.joinRoomBtn.disabled = true;
        console.log('🏠 [JOIN] Join room button disabled');
      }
      
      console.log('🏠 [JOIN] Updating UI for user type...');
      this.updateUIForUserType();
      
      // Add a timeout in case the server doesn't respond
      setTimeout(() => {
        if (!this.roomId) {
          console.warn('⏰ [JOIN] No room-joined response received within 10 seconds');
          if (this.joinRoomBtn) {
            this.joinRoomBtn.disabled = false;
          }
          alert('Join room timeout - please try again');
        }
      }, 10000);
      
    } catch (error) {
      console.error('❌ [JOIN] Error joining room:', error);
      alert('Error joining room: ' + error.message);
    }
  }

  async loadDeviceWithCapabilities(rtpCapabilities) {
    try {
      // Load mediasoup-client device
      if (!window.mediasoupClient) {
        throw new Error('mediasoupClient not loaded');
      }
      
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      
      console.log('Mediasoup device loaded successfully');
      this.updateStatus('Device Loaded', true);
    } catch (error) {
      console.error('Error loading device:', error);
      throw error;
    }
  }

  async loadDevice() {
    try {
      // Get router RTP capabilities from mediasoup server
      const rtpCapabilities = await new Promise((resolve, reject) => {
        this.socket.emit('get-router-rtp-capabilities', (capabilities) => {
          if (capabilities) {
            resolve(capabilities);
          } else {
            reject(new Error('Failed to get router capabilities'));
          }
        });
      });

      // Load mediasoup-client device
      if (!window.mediasoupClient) {
        throw new Error('mediasoupClient not loaded');
      }
      
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      
      console.log('Mediasoup device loaded successfully');
      this.updateStatus('Device Loaded', true);
    } catch (error) {
      console.error('Error loading device:', error);
      throw error;
    }
  }

  async startStream() {
    try {
      // Get user media with better configuration like app.js
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Rebuild layout to show local video like app.js
      this.rebuildVideoLayout();
      
      // Create producer transport
      await this.createProducerTransport();
      
      // Produce video and audio
      const videoTrack = this.localStream.getVideoTracks()[0];
      const audioTrack = this.localStream.getAudioTracks()[0];
      
      if (videoTrack) {
        await this.produce(videoTrack, 'video');
      }
      
      if (audioTrack) {
        await this.produce(audioTrack, 'audio');
      }
      
      this.startStreamBtn.disabled = true;
      this.stopStreamBtn.disabled = false;
      this.updateStatus('Streaming', true);
      
      console.log('Started streaming with MediaSoup');
      this.addChatMessage('You started streaming', 'system');
      
    } catch (error) {
      console.error('Error starting stream:', error);
      alert('Error starting stream: ' + error.message);
    }
  }

  async createProducerTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-transport', { 
        type: 'producer',
        roomId: this.roomId,
        participantId: this.username
      }, async (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        try {
          console.log('🚛 [TRANSPORT] Creating producer transport with params:', {
            id: response.id,
            iceParameters: response.iceParameters ? 'available' : 'missing',
            iceCandidates: response.iceCandidates ? response.iceCandidates.length : 0,
            dtlsParameters: response.dtlsParameters ? 'available' : 'missing'
          });
          
          this.producerTransport = this.device.createSendTransport(response);
          console.log('🚛 [TRANSPORT] Producer transport created, state:', this.producerTransport.connectionState);
          
          // Add connection state monitoring
          this.producerTransport.on('connectionstatechange', (state) => {
            console.log('🚛 [TRANSPORT] Producer transport connection state changed to:', state);
          });
          
          this.producerTransport.on('connect', async ({ dtlsParameters }, callback) => {
            console.log('🚛 [TRANSPORT] Producer transport connect event fired');
            console.log('🚛 [TRANSPORT] DTLS parameters available:', !!dtlsParameters);
            
            this.socket.emit('connect-transport', {
              transportId: this.producerTransport.id,
              dtlsParameters
            }, (result) => {
              console.log('🚛 [TRANSPORT] Connect transport response:', result);
              callback(result);
            });
          });

          this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback) => {
            console.log('🚛 [TRANSPORT] Producer transport produce event fired for:', kind);
            
            this.socket.emit('produce', {
              transportId: this.producerTransport.id,
              kind,
              rtpParameters,
              roomId: this.roomId,
              participantId: this.username
            }, (result) => {
              console.log('🚛 [TRANSPORT] Produce response:', result);
              callback(result);
            });
          });

          this.producerTransport.on('icestatechange', (iceState) => {
            console.log('🚛 [TRANSPORT] Producer transport ICE state changed to:', iceState);
          });

          this.producerTransport.on('iceconnectionstatechange', (iceConnectionState) => {
            console.log('🚛 [TRANSPORT] Producer transport ICE connection state changed to:', iceConnectionState);
          });

          console.log('✅ [TRANSPORT] Producer transport setup completed');
          resolve();
        } catch (error) {
          console.error('❌ [TRANSPORT] Error creating producer transport:', error);
          reject(error);
        }
      });
    });
  }

  async produce(track, kind) {
    try {
      this.producer = await this.producerTransport.produce({
        track,
        ...this.device.rtpCapabilities.codecs
          .filter(codec => codec.kind === kind)
          .slice(0, 1)
          .map(codec => ({ codec }))
      });

      console.log(`Producer created for ${kind}:`, this.producer.id);
    } catch (error) {
      console.error(`Error producing ${kind}:`, error);
      throw error;
    }
  }

  async consumeStream(producerId, participantId, kind) {
    try {
      console.log('🎥 [CONSUME] Starting consume for producer:', producerId, 'from peer:', participantId, 'kind:', kind);
      
      if (!this.device.rtpCapabilities) {
        console.error('🎥 [CONSUME] Device not loaded');
        return;
      }

      // Create consumer transport if not exists (reuse single transport)
      if (!this.consumerTransport) {
        if (this.consumerTransportCreating) {
          // Wait for existing transport creation to complete
          console.log('🎥 [CONSUME] Waiting for consumer transport creation...');
          while (this.consumerTransportCreating && !this.consumerTransport) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else {
          console.log('🎥 [CONSUME] Creating consumer transport...');
          this.consumerTransportCreating = true;
          try {
            await this.createConsumerTransport();
          } finally {
            this.consumerTransportCreating = false;
          }
        }
      } else {
        console.log('🎥 [CONSUME] Reusing existing consumer transport');
      }

      // Request to consume the stream
      console.log('🎥 [CONSUME] Requesting consume from server...', {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities ? 'available' : 'missing'
      });
      
      this.socket.emit('consume', {
        transportId: this.consumerTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
        roomId: this.roomId,
        participantId: this.username
      }, async (response) => {
        console.log('🎥 [CONSUME] Consume response:', response);
        
        if (response.error) {
          console.error('🎥 [CONSUME] Error consuming:', response.error);
          return;
        }

        try {
          console.log('🎥 [CONSUME] Creating consumer with params:', {
            id: response.id,
            producerId,
            kind: response.kind,
            rtpParameters: response.rtpParameters ? 'available' : 'missing'
          });
          
          const consumer = await this.consumerTransport.consume({
            id: response.id,
            producerId,
            kind: response.kind,
            rtpParameters: response.rtpParameters
          });

          this.consumers.set(consumer.id, consumer);
          console.log('🎥 [CONSUME] Consumer created:', consumer.id);

          // Resume the consumer
          this.socket.emit('resume-consumer', { consumerId: consumer.id }, (result) => {
            if (result && result.error) {
              console.error('🎥 [CONSUME] Error resuming consumer:', result.error);
            } else {
              console.log('🎥 [CONSUME] Consumer resumed successfully');
            }
          });

          // Store the track by peer and kind
          if (!this.peerTracks.has(participantId)) {
            this.peerTracks.set(participantId, {});
          }
          this.peerTracks.get(participantId)[kind] = consumer.track;
          
          console.log('🎥 [CONSUME] Stored track for peer:', participantId, 'kind:', kind);
          console.log('🎥 [CONSUME] Track state:', consumer.track.readyState);
          console.log('🎥 [CONSUME] Track enabled:', consumer.track.enabled);
          console.log('🎥 [CONSUME] Track muted:', consumer.track.muted);
          console.log('🎥 [CONSUME] Peer tracks now:', this.peerTracks.get(participantId));
          
          // Create or update the peer's stream (debounced)
          this.updatePeerStreamDebounced(participantId);
          
          console.log('🎥 [CONSUME] Updated stream for peer:', participantId);

        } catch (error) {
          console.error('🎥 [CONSUME] Error creating consumer:', error);
        }
      });
    } catch (error) {
      console.error('Error consuming stream:', error);
    }
  }

  async createConsumerTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-transport', { 
        type: 'consumer',
        roomId: this.roomId,
        participantId: this.username
      }, async (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        try {
          console.log('🚛 [TRANSPORT] Creating consumer transport with params:', {
            id: response.id,
            iceParameters: response.iceParameters ? 'available' : 'missing',
            iceCandidates: response.iceCandidates ? response.iceCandidates.length : 0,
            dtlsParameters: response.dtlsParameters ? 'available' : 'missing'
          });
          
          this.consumerTransport = this.device.createRecvTransport(response);
          console.log('🚛 [TRANSPORT] Consumer transport created, state:', this.consumerTransport.connectionState);
          
          // Add connection state monitoring
          this.consumerTransport.on('connectionstatechange', (state) => {
            console.log('🚛 [TRANSPORT] Consumer transport connection state changed to:', state);
          });
          
          this.consumerTransport.on('connect', async ({ dtlsParameters }, callback) => {
            console.log('🚛 [TRANSPORT] Consumer transport connect event fired');
            console.log('🚛 [TRANSPORT] DTLS parameters available:', !!dtlsParameters);
            
            this.socket.emit('connect-transport', {
              transportId: this.consumerTransport.id,
              dtlsParameters
            }, (result) => {
              console.log('🚛 [TRANSPORT] Connect transport response:', result);
              callback(result);
            });
          });

          this.consumerTransport.on('icestatechange', (iceState) => {
            console.log('🚛 [TRANSPORT] Consumer transport ICE state changed to:', iceState);
          });

          this.consumerTransport.on('iceconnectionstatechange', (iceConnectionState) => {
            console.log('🚛 [TRANSPORT] Consumer transport ICE connection state changed to:', iceConnectionState);
          });

          console.log('✅ [TRANSPORT] Consumer transport setup completed');
          resolve();
        } catch (error) {
          console.error('❌ [TRANSPORT] Error creating consumer transport:', error);
          reject(error);
        }
      });
    });
  }

  stopStream() {
    if (this.localStream) {
      console.log('Stopping local stream tracks...');
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.producer) {
      this.producer.close();
      this.producer = null;
    }

    if (this.producerTransport) {
      this.producerTransport.close();
      this.producerTransport = null;
    }

    // Rebuild layout to remove local video
    this.rebuildVideoLayout();

    this.startStreamBtn.disabled = false;
    this.stopStreamBtn.disabled = true;
    this.updateStatus('Connected', true);
    
    console.log('Stopped streaming');
    this.addChatMessage('You stopped streaming', 'system');
  }

  sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;

    this.socket.emit('chat-message', { message });
    this.addChatMessage(`You: ${message}`, 'local');
    this.chatInput.value = '';
  }

  addChatMessage(message, type = 'system') {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.chatMessages.appendChild(messageEl);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  // Video layout methods from app.js
  rebuildVideoLayout() {
    // Clear existing layouts
    this.streamerVideoSection.innerHTML = '';
    
    const isStreamer = this.userType === 'streamer';
    const hasLocalStream = !!this.localStream;
    const hasRemoteStreams = this.remoteStreams.size > 0;
    
    // Add local video if user is streaming (goes in streamer section)
    if (isStreamer && hasLocalStream) {
      this.createLocalVideoElement();
    }
    
    // Add remote videos for all peers with streams (goes in streamer section)
    this.remoteStreams.forEach((stream, peerId) => {
      this.createRemoteVideoElement(peerId, stream);
    });
    
    // Show appropriate empty messages
    if (!isStreamer && !hasRemoteStreams) {
      this.streamerVideoSection.innerHTML = '<div class="empty-video-message">No active streams. Waiting for streamers to join...</div>';
    } else if (isStreamer && hasLocalStream && !hasRemoteStreams) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-video-message';
      emptyMsg.textContent = 'You are streaming. Waiting for other streamers to join...';
      this.streamerVideoSection.appendChild(emptyMsg);
    } else if (!hasLocalStream && !hasRemoteStreams) {
      this.streamerVideoSection.innerHTML = '<div class="empty-video-message">No active streams.</div>';
    }
  }

  createLocalVideoElement() {
    // Use the existing local video element from HTML
    const video = document.getElementById('localVideo');
    if (video) {
      video.srcObject = this.localStream;
      video.style.display = 'block';
      this.localVideo = video;
      console.log('Set local stream to existing video element');
    } else {
      console.error('Local video element not found in HTML');
    }
  }

  createRemoteVideoElement(peerId, stream) {
    // Remove existing element if it exists
    this.removeRemoteVideoElement(peerId);
    
    console.log('Creating video element for peer:', peerId, 'Stream tracks:', stream.getTracks().length);
    console.log('🎥 [STREAM] Stream info:', {
      id: stream.id,
      active: stream.active,
      tracks: stream.getTracks().map(t => ({
        kind: t.kind,
        id: t.id,
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted,
        settings: t.getSettings()
      }))
    });
    
    const container = document.createElement('div');
    container.className = 'video-container remote';
    container.id = `remote-video-${peerId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    video.muted = false; // Don't mute remote videos
    video.controls = false; // No controls for cleaner look
    
    // Set srcObject before adding to DOM
    video.srcObject = stream;

    // Add video event listeners for debugging
    video.onloadedmetadata = () => {
      console.log('🎥 [VIDEO] Video metadata loaded for', peerId, 'Size:', video.videoWidth, 'x', video.videoHeight);
      console.log('🎥 [VIDEO] Stream active:', stream.active);
      console.log('🎥 [VIDEO] Stream tracks:', stream.getTracks().map(t => `${t.kind}: ${t.readyState}`));
      console.log('🎥 [VIDEO] Video readyState:', video.readyState);
      console.log('🎥 [VIDEO] Video src:', video.src || 'srcObject');
    };
    
    video.oncanplay = () => {
      console.log('🎥 [VIDEO] Video can play for', peerId);
    };
    
    video.onplay = () => {
      console.log('🎥 [VIDEO] Video started playing for', peerId);
    };
    
    video.onerror = (e) => {
      console.error('🎥 [VIDEO] Video error for', peerId, ':', e);
    };

    video.onloadstart = () => {
      console.log('🎥 [VIDEO] Video load started for', peerId);
    };

    video.onstalled = () => {
      console.log('🎥 [VIDEO] Video stalled for', peerId);
    };

    video.onwaiting = () => {
      console.log('🎥 [VIDEO] Video waiting for', peerId);
    };

    // Add dimension change listener
    video.onresize = () => {
      console.log('🎥 [VIDEO] Video dimensions changed for', peerId, ':', video.videoWidth, 'x', video.videoHeight);
    };

    // Force trigger loadedmetadata if already loaded
    if (video.readyState >= 1) {
      video.onloadedmetadata();
    }

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `📺 Stream from ${peerId.substring(0, 8)}...`;

    // Add a play button as fallback for autoplay issues
    const playButton = document.createElement('button');
    playButton.textContent = '▶️ Click to Play';
    playButton.className = 'play-button';
    playButton.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10;
      padding: 10px 20px;
      background: rgba(0,0,0,0.7);
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      display: none;
    `;

    container.appendChild(video);
    container.appendChild(label);
    container.appendChild(playButton);
    this.streamerVideoSection.appendChild(container);

    // Try to play the video immediately
    const attemptPlay = async () => {
      try {
        console.log('🎥 [VIDEO] Attempting to play video for', peerId);
        await video.play();
        console.log('🎥 [VIDEO] Video started playing successfully for', peerId);
        playButton.style.display = 'none';
      } catch (e) {
        console.log('🎥 [VIDEO] Video play failed for', peerId, ':', e.message);
        console.log('🎥 [VIDEO] Showing play button for manual start');
        playButton.style.display = 'block';
      }
    };

    // Try immediate play
    attemptPlay();

    // Also try after metadata loads
    video.addEventListener('loadedmetadata', attemptPlay, { once: true });

    // Manual play button click handler
    playButton.addEventListener('click', () => {
      console.log('🎥 [VIDEO] Manual play button clicked for', peerId);
      video.play()
        .then(() => {
          console.log('🎥 [VIDEO] Manual play successful for', peerId);
          playButton.style.display = 'none';
        })
        .catch(e => {
          console.error('🎥 [VIDEO] Manual play failed for', peerId, ':', e);
        });
    });

    // Debug video state after 2 seconds
    setTimeout(() => {
      console.log('🔍 [DEBUG] Video state check for', peerId, ':', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        paused: video.paused,
        ended: video.ended,
        currentTime: video.currentTime,
        duration: video.duration,
        networkState: video.networkState,
        srcObject: !!video.srcObject,
        streamActive: stream.active,
        streamTracks: stream.getTracks().map(t => ({
          kind: t.kind,
          readyState: t.readyState,
          enabled: t.enabled,
          muted: t.muted
        }))
      });
      
      // Force show play button if video has no dimensions or is not playing
      if ((video.videoWidth === 0 && video.videoHeight === 0) || video.paused) {
        console.warn('🔍 [DEBUG] Video appears to have issues - forcing play button display');
        playButton.style.display = 'block';
        playButton.style.backgroundColor = 'rgba(255, 0, 0, 0.8)'; // Red to indicate forced display
        playButton.textContent = '🔧 Debug Play';
      }
      
      if (video.videoWidth === 0 && video.videoHeight === 0) {
        console.warn('🔍 [DEBUG] Video has no dimensions - checking if track is producing data');
        console.log('🔍 [DEBUG] Video appears to have issues - forcing play button display');
        playButton.style.display = 'block';
        
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          console.log('🔍 [DEBUG] Video track details:', {
            kind: videoTrack.kind,
            id: videoTrack.id,
            label: videoTrack.label,
            readyState: videoTrack.readyState,
            enabled: videoTrack.enabled,
            muted: videoTrack.muted,
            settings: videoTrack.getSettings(),
            constraints: videoTrack.getConstraints()
          });
          
          // Check if track is receiving data
          console.log('🔍 [DEBUG] Checking if track is receiving data...');
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 1;
          canvas.height = 1;
          
          // Try to draw the video to canvas to see if there's content
          setTimeout(() => {
            try {
              ctx.drawImage(video, 0, 0, 1, 1);
              const imageData = ctx.getImageData(0, 0, 1, 1);
              const hasData = imageData.data.some(val => val !== 0);
              console.log('🔍 [DEBUG] Canvas test - has video data:', hasData);
              console.log('🔍 [DEBUG] Video current time:', video.currentTime);
              console.log('🔍 [DEBUG] Video buffered ranges:', video.buffered.length);
            } catch (e) {
              console.log('🔍 [DEBUG] Canvas test failed:', e.message);
            }
          }, 1000);
        }
      }
    }, 2000);

    console.log('Created video element for peer:', peerId);
  }

  removeRemoteVideoElement(peerId) {
    const container = document.getElementById(`remote-video-${peerId}`);
    if (container) {
      container.remove();
      console.log('Removed video element for peer:', peerId);
    }
 }

  updatePeerStreamDebounced(socketId) {
    console.log('🎥 [DEBOUNCE] Debounced update called for peer:', socketId);
    
    // Clear any existing timeout for this peer
    const existingTimeout = this.layoutUpdateTimeouts.get(socketId);
    if (existingTimeout) {
      console.log('🎥 [DEBOUNCE] Clearing existing timeout for peer:', socketId);
      clearTimeout(existingTimeout);
    }
    
    // Set a short timeout to batch track updates
    const timeout = setTimeout(() => {
      console.log('🎥 [DEBOUNCE] Timeout fired for peer:', socketId);
      this.updatePeerStream(socketId);
      this.layoutUpdateTimeouts.delete(socketId);
    }, 100); // 100ms debounce
    
    this.layoutUpdateTimeouts.set(socketId, timeout);
    console.log('🎥 [DEBOUNCE] Set timeout for peer:', socketId);
  }

  updatePeerStream(socketId) {
    console.log('🎥 [STREAM] Updating stream for peer:', socketId);
    
    const tracks = this.peerTracks.get(socketId);
    if (!tracks) {
      console.log('🎥 [STREAM] No tracks found for peer:', socketId);
      return;
    }

    // Create stream with available tracks
    const streamTracks = [];
    if (tracks.video) {
      console.log('🎥 [STREAM] Adding video track for peer:', socketId);
      streamTracks.push(tracks.video);
    }
    if (tracks.audio) {
      console.log('🎥 [STREAM] Adding audio track for peer:', socketId);
      streamTracks.push(tracks.audio);
    }

    if (streamTracks.length === 0) {
      console.log('🎥 [STREAM] No valid tracks for peer:', socketId);
      return;
    }

    const stream = new MediaStream(streamTracks);
    console.log('🎥 [STREAM] Created stream with', streamTracks.length, 'tracks for peer:', socketId);
    console.log('🎥 [STREAM] Track details:', streamTracks.map(t => ({
      kind: t.kind,
      id: t.id,
      readyState: t.readyState,
      enabled: t.enabled,
      muted: t.muted
    })));
    console.log('🎥 [STREAM] Stream details:', {
      id: stream.id,
      active: stream.active,
      tracks: stream.getTracks().length
    });
    
    // Update our stream management (using socketId as peerId)
    this.remoteStreams.set(socketId, stream);
    this.activeStreamers.add(socketId);
    this.peerStreams.set(socketId, stream);
    
    console.log('🎥 [STREAM] Updated stream management - Remote streams count:', this.remoteStreams.size);
    
    // Rebuild layout to show the updated stream
    this.rebuildVideoLayout();
  }
}

// Initialize the MediaSoup client when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 [INIT] DOMContentLoaded event fired');
  console.log('🚀 [INIT] Checking if mediasoupClient is available...');
  
  if (typeof mediasoupClient === 'undefined') {
    console.error('❌ [INIT] mediasoupClient not loaded');
    alert('Error: mediasoupClient library not loaded. Please refresh the page.');
    return;
  }
  
  console.log('✅ [INIT] mediasoupClient is available');
  console.log('🚀 [INIT] Creating new MediasoupClient instance...');
  
  try {
    const client = new MediasoupClient();
    console.log('✅ [INIT] MediasoupClient instance created successfully:', client);
    window.mediasoupClientInstance = client; // Store for debugging
    
    // Add global debug function
    window.debugVideoState = () => {
      console.log('🔍 [DEBUG] === VIDEO STATE DEBUG ===');
      console.log('🔍 [DEBUG] User type:', client.userType);
      console.log('🔍 [DEBUG] Room ID:', client.roomId);
      console.log('🔍 [DEBUG] Remote streams count:', client.remoteStreams.size);
      console.log('🔍 [DEBUG] Peer tracks:', client.peerTracks);
      console.log('🔍 [DEBUG] Peer streams:', client.peerStreams);
      console.log('🔍 [DEBUG] Consumers:', client.consumers);
      
      // Check all video elements
      const videoElements = document.querySelectorAll('video');
      console.log('🔍 [DEBUG] Found', videoElements.length, 'video elements:');
      videoElements.forEach((video, index) => {
        console.log(`🔍 [DEBUG] Video ${index}:`, {
          id: video.id,
          src: video.src,
          srcObject: !!video.srcObject,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
          paused: video.paused,
          currentTime: video.currentTime,
          duration: video.duration,
          autoplay: video.autoplay,
          muted: video.muted
        });
        
        if (video.srcObject) {
          const stream = video.srcObject;
          console.log(`🔍 [DEBUG] Video ${index} stream:`, {
            id: stream.id,
            active: stream.active,
            tracks: stream.getTracks().map(t => ({
              kind: t.kind,
              id: t.id,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            }))
          });
        }
      });
      
      // Check for play buttons
      const playButtons = document.querySelectorAll('.play-button');
      console.log('🔍 [DEBUG] Found', playButtons.length, 'play buttons:');
      playButtons.forEach((btn, index) => {
        console.log(`🔍 [DEBUG] Play button ${index}:`, {
          display: btn.style.display,
          visible: btn.offsetWidth > 0 && btn.offsetHeight > 0
        });
      });
      
      console.log('🔍 [DEBUG] === END DEBUG ===');
    };
    
    // Add function to force show play buttons for testing
    window.forceShowPlayButtons = () => {
      console.log('🔧 [FORCE] Forcing play buttons to show...');
      const playButtons = document.querySelectorAll('.play-button');
      playButtons.forEach((btn, index) => {
        btn.style.display = 'block';
        console.log(`🔧 [FORCE] Showed play button ${index}`);
      });
    };
    
    // Add function to try playing all videos
    window.playAllVideos = () => {
      console.log('▶️ [PLAY] Attempting to play all videos...');
      const videos = document.querySelectorAll('video');
      videos.forEach((video, index) => {
        if (video.paused) {
          console.log(`▶️ [PLAY] Trying to play video ${index}...`);
          video.play()
            .then(() => console.log(`✅ [PLAY] Video ${index} started playing`))
            .catch(e => console.log(`❌ [PLAY] Video ${index} failed to play:`, e.message));
        } else {
          console.log(`▶️ [PLAY] Video ${index} is already playing`);
        }
      });
    };
    
    // Add function to check transport connection status
    window.checkTransports = () => {
      console.log('🚛 [TRANSPORT] === TRANSPORT STATUS ===');
      console.log('🚛 [TRANSPORT] Producer transport:', client.producerTransport ? 'exists' : 'null');
      if (client.producerTransport) {
        console.log('🚛 [TRANSPORT] Producer transport state:', client.producerTransport.connectionState);
        console.log('🚛 [TRANSPORT] Producer transport closed:', client.producerTransport.closed);
      }
      
      console.log('🚛 [TRANSPORT] Consumer transport:', client.consumerTransport ? 'exists' : 'null');
      if (client.consumerTransport) {
        console.log('🚛 [TRANSPORT] Consumer transport state:', client.consumerTransport.connectionState);
        console.log('🚛 [TRANSPORT] Consumer transport closed:', client.consumerTransport.closed);
      }
      
      console.log('🚛 [TRANSPORT] Consumers:');
      client.consumers.forEach((consumer, id) => {
        console.log(`🚛 [TRANSPORT] Consumer ${id}:`, {
          kind: consumer.kind,
          closed: consumer.closed,
          paused: consumer.paused,
          producerPaused: consumer.producerPaused
        });
      });
      
      console.log('🚛 [TRANSPORT] === END TRANSPORT STATUS ===');
    };
    
  } catch (error) {
    console.error('❌ [INIT] Error creating MediasoupClient:', error);
    alert('Error initializing client: ' + error.message);
  }
});
