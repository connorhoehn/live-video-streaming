/**
 * Room Manager - Handles room lifecycle and participant management
 * Integrated from sample_cluster architecture
 */

const EventEmitter = require('events');

class RoomManager extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map();
    this.participantToRoom = new Map();
    this.roomRouters = new Map(); // roomId -> routerId mapping
  }

  /**
   * Create a new room with MediaSoup router
   */
  async createRoom(roomOptions = {}) {
    const roomId = roomOptions.roomId || this.generateRoomId();
    
    const room = {
      id: roomId,
      routerId: null, // Will be set when router is created
      participants: new Map(),
      producers: new Map(), // participantId -> Set of producer IDs
      consumers: new Map(), // participantId -> Set of consumer IDs
      transports: new Map(), // transportId -> transport info
      metadata: roomOptions.metadata || {},
      createdAt: new Date(),
      settings: {
        maxParticipants: roomOptions.maxParticipants || 100,
        allowProducers: roomOptions.allowProducers !== false,
        allowConsumers: roomOptions.allowConsumers !== false,
        ...roomOptions.settings
      }
    };

    this.rooms.set(roomId, room);
    console.log(`🏠 Room created: ${roomId}`);
    
    this.emit('roomCreated', { roomId, room });
    return room;
  }

  /**
   * Get room by ID
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Get all rooms
   */
  getAllRooms() {
    const rooms = {};
    for (const [roomId, room] of this.rooms.entries()) {
      rooms[roomId] = {
        id: room.id,
        routerId: room.routerId,
        participants: Object.fromEntries(room.participants),
        producers: Object.fromEntries(room.producers),
        consumers: Object.fromEntries(room.consumers),
        transports: Object.fromEntries(room.transports),
        metadata: room.metadata,
        createdAt: room.createdAt,
        settings: room.settings
      };
    }
    return rooms;
  }
  
  /**
   * Get participant from a room
   */
  getParticipant(roomId, participantId) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    return room.participants.get(participantId);
  }

  /**
   * Join a participant to a room
   */
  async joinRoom(roomId, participantId, participantInfo = {}) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.participants.size >= room.settings.maxParticipants) {
      throw new Error(`Room ${roomId} is full`);
    }

    if (room.participants.has(participantId)) {
      throw new Error(`Participant ${participantId} already in room ${roomId}`);
    }

    const participant = {
      id: participantId,
      roomId,
      joinedAt: new Date(),
      transports: new Map(), // Changed from Set to Map
      producers: new Map(),  // Changed from Set to Map
      consumers: new Map(),  // Changed from Set to Map
      metadata: participantInfo.metadata || {},
      ...participantInfo
    };

    room.participants.set(participantId, participant);
    this.participantToRoom.set(participantId, roomId);
    room.producers.set(participantId, new Map()); // Changed from Set to Map
    room.consumers.set(participantId, new Map()); // Changed from Set to Map

    console.log(`👤 Participant ${participantId} joined room ${roomId}`);
    this.emit('participantJoined', { roomId, participantId, participant });

    return participant;
  }

  /**
   * Leave a participant from a room
   */
  async leaveRoom(participantId) {
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) {
      return null;
    }

    const room = this.getRoom(roomId);
    if (!room) {
      return null;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return null;
    }

    // Clean up participant data
    room.participants.delete(participantId);
    room.producers.delete(participantId);
    room.consumers.delete(participantId);
    this.participantToRoom.delete(participantId);

    console.log(`👤 Participant ${participantId} left room ${roomId}`);
    this.emit('participantLeft', { roomId, participantId, participant });

    // Auto-close empty rooms
    if (room.participants.size === 0) {
      await this.closeRoom(roomId);
    }

    return participant;
  }

  /**
   * Close a room and clean up resources
   */
  async closeRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return false;
    }

    // Remove all participants
    for (const participantId of room.participants.keys()) {
      this.participantToRoom.delete(participantId);
    }

    this.rooms.delete(roomId);
    this.roomRouters.delete(roomId);

    console.log(`🏠 Room closed: ${roomId}`);
    this.emit('roomClosed', { roomId, room });

    return true;
  }

  /**
   * Add transport to room
   */
  addTransport(roomId, participantId, transportId, transportInfo) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found in room ${roomId}`);
    }

    room.transports.set(transportId, {
      id: transportId,
      participantId,
      roomId,
      type: transportInfo.type, // 'producer' or 'consumer'
      createdAt: new Date(),
      ...transportInfo
    });

    participant.transports.add(transportId);
    console.log(`🚛 Transport ${transportId} added to room ${roomId} for participant ${participantId}`);
  }

  /**
   * Remove transport from room
   */
  removeTransport(roomId, transportId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return false;
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      return false;
    }

    const participant = room.participants.get(transport.participantId);
    if (participant) {
      participant.transports.delete(transportId);
    }

    room.transports.delete(transportId);
    console.log(`🚛 Transport ${transportId} removed from room ${roomId}`);
    return true;
  }

  /**
   * Add producer to room
   */
  addProducer(roomId, participantId, producerId, producerInfo) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found in room ${roomId}`);
    }

    const participantProducers = room.producers.get(participantId);
    participantProducers.add(producerId);
    participant.producers.add(producerId);

    console.log(`📤 Producer ${producerId} added to room ${roomId} for participant ${participantId}`);
    this.emit('producerAdded', { roomId, participantId, producerId, ...producerInfo });
  }

  /**
   * Remove producer from room
   */
  removeProducer(roomId, participantId, producerId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return false;
    }

    const participantProducers = room.producers.get(participantId);
    participantProducers.delete(producerId);
    participant.producers.delete(producerId);

    console.log(`📤 Producer ${producerId} removed from room ${roomId} for participant ${participantId}`);
    this.emit('producerRemoved', { roomId, participantId, producerId });
    return true;
  }

  /**
   * Add consumer to room
   */
  addConsumer(roomId, participantId, consumerId, consumerInfo) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found in room ${roomId}`);
    }

    const participantConsumers = room.consumers.get(participantId);
    participantConsumers.add(consumerId);
    participant.consumers.add(consumerId);

    console.log(`📥 Consumer ${consumerId} added to room ${roomId} for participant ${participantId}`);
    this.emit('consumerAdded', { roomId, participantId, consumerId, ...consumerInfo });
  }

  /**
   * Remove consumer from room
   */
  removeConsumer(roomId, participantId, consumerId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return false;
    }

    const participantConsumers = room.consumers.get(participantId);
    participantConsumers.delete(consumerId);
    participant.consumers.delete(consumerId);

    console.log(`📥 Consumer ${consumerId} removed from room ${roomId} for participant ${participantId}`);
    this.emit('consumerRemoved', { roomId, participantId, consumerId });
    return true;
  }

  /**
   * Get room for participant
   */
  getRoomForParticipant(participantId) {
    const roomId = this.participantToRoom.get(participantId);
    return roomId ? this.getRoom(roomId) : null;
  }

  /**
   * Get all producers in a room (for consumers to subscribe to)
   */
  getRoomProducers(roomId, excludeParticipantId = null) {
    const room = this.getRoom(roomId);
    if (!room) {
      return [];
    }

    const producers = [];
    for (const [participantId, participant] of room.participants.entries()) {
      if (participantId === excludeParticipantId) continue;
      
      if (participant.producers && participant.producers.size > 0) {
        for (const [producerId, producerInfo] of participant.producers.entries()) {
          producers.push({
            id: producerId,
            participantId,
            kind: producerInfo.kind,
            participantMetadata: participant.metadata || {}
          });
        }
      }
    }

    return producers;
  }

  /**
   * Set router for a room
   */
  async setRoomRouter(roomId, routerId) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    
    room.routerId = routerId;
    this.roomRouters.set(roomId, routerId);
    return true;
  }

  /**
   * Get router ID for a room
   */
  getRoomRouterId(roomId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return null;
    }
    return room.routerId;
  }
  
  /**
   * Add transport to participant
   */
  async addTransportToParticipant(roomId, participantId, transportId, transportType) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    
    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found in room ${roomId}`);
    }
    
    // Initialize participant's transports if needed
    if (!participant.transports) {
      participant.transports = new Map();
    }
    
    // Add transport
    participant.transports.set(transportId, {
      id: transportId,
      type: transportType,
      timestamp: new Date()
    });
    
    return true;
  }
  
  /**
   * Add producer to participant
   */
  async addProducerToParticipant(roomId, participantId, producerId, metadata = {}) {
    console.log(`🔍 [DEBUG] Adding producer ${producerId} to participant ${participantId} in room ${roomId}`);
    
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    
    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found in room ${roomId}`);
    }
    
    // Initialize room's producers map for this participant if needed
    if (!room.producers.has(participantId)) {
      room.producers.set(participantId, new Map()); // Changed from Set to Map
    }
    
    // Add producer to room
    room.producers.get(participantId).set(producerId, { // Changed from add to set
      id: producerId,
      ...metadata,
      timestamp: new Date()
    });
    
    // Initialize participant's producers if needed
    if (!participant.producers) {
      participant.producers = new Map();
    }
    
    // Add producer to participant
    participant.producers.set(producerId, {
      id: producerId,
      ...metadata,
      timestamp: new Date()
    });
    
    console.log(`✅ [DEBUG] Producer ${producerId} added successfully. Participant now has ${participant.producers.size} producers`);
    
    return true;
  }
  
  /**
   * Add consumer to participant
   */
  async addConsumerToParticipant(roomId, participantId, consumerId, metadata = {}) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    
    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found in room ${roomId}`);
    }
    
    // Initialize room's consumers map for this participant if needed
    if (!room.consumers.has(participantId)) {
      room.consumers.set(participantId, new Map()); // Changed from Set to Map
    }
    
    // Add consumer to room
    room.consumers.get(participantId).set(consumerId, { // Changed from add to set
      id: consumerId,
      ...metadata,
      timestamp: new Date()
    });
    
    // Initialize participant's consumers if needed
    if (!participant.consumers) {
      participant.consumers = new Map();
    }
    
    // Add consumer to participant
    participant.consumers.set(consumerId, {
      id: consumerId,
      ...metadata,
      timestamp: new Date()
    });
    
    return true;
  }
  
  /**
   * Generate a random room ID
   */
  generateRoomId() {
    return `room_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Get room statistics
   */
  getRoomStats(roomId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return null;
    }

    return {
      id: room.id,
      participantCount: room.participants.size,
      transportCount: room.transports.size,
      producerCount: Array.from(room.producers.values()).reduce((sum, set) => sum + set.size, 0),
      consumerCount: Array.from(room.consumers.values()).reduce((sum, set) => sum + set.size, 0),
      createdAt: room.createdAt,
      uptime: Date.now() - room.createdAt.getTime(),
      metadata: room.metadata
    };
  }

  /**
   * Get global statistics
   */
  getGlobalStats() {
    const roomStats = Array.from(this.rooms.values()).map(room => this.getRoomStats(room.id));
    
    return {
      totalRooms: this.rooms.size,
      totalParticipants: Array.from(this.rooms.values()).reduce((sum, room) => sum + room.participants.size, 0),
      totalTransports: Array.from(this.rooms.values()).reduce((sum, room) => sum + room.transports.size, 0),
      totalProducers: Array.from(this.rooms.values()).reduce((sum, room) => 
        sum + Array.from(room.producers.values()).reduce((pSum, set) => pSum + set.size, 0), 0),
      totalConsumers: Array.from(this.rooms.values()).reduce((sum, room) => 
        sum + Array.from(room.consumers.values()).reduce((cSum, set) => cSum + set.size, 0), 0),
      roomStats
    };
  }

  /**
   * Get all streams (producers) across all rooms
   * Returns a Map-like object that can be iterated with .values()
   */
  getStreams() {
    const streams = new Map();
    
    this.rooms.forEach(room => {
      room.producers.forEach((producerSet, participantId) => {
        const participant = room.participants.get(participantId);
        if (participant && producerSet.size > 0) {
          const streamId = `${room.id}-${participantId}`;
          const audioProducers = Array.from(producerSet).filter(p => p.kind === 'audio');
          const videoProducers = Array.from(producerSet).filter(p => p.kind === 'video');
          
          streams.set(streamId, {
            id: streamId,
            name: participant.metadata?.displayName || participantId,
            roomId: room.id,
            participantId,
            hasAudio: audioProducers.length > 0,
            hasVideo: videoProducers.length > 0,
            audioProducerId: audioProducers[0]?.id,
            videoProducerId: videoProducers[0]?.id,
            active: true,
            createdAt: participant.joinedAt,
            producers: new Map([
              ...(audioProducers.length > 0 ? [['audio', audioProducers[0]]] : []),
              ...(videoProducers.length > 0 ? [['video', videoProducers[0]]] : [])
            ])
          });
        }
      });
    });
    
    return streams;
  }

  /**
   * Get all streams across all rooms
   */
  getAllStreams() {
    const streams = new Map();
    
    this.rooms.forEach((room, roomId) => {
      room.producers.forEach((producerSet, participantId) => {
        producerSet.forEach(producerId => {
          const streamId = `${roomId}-${participantId}`;
          if (!streams.has(streamId)) {
            streams.set(streamId, {
              id: streamId,
              name: `${room.metadata.name || roomId} - ${participantId}`,
              roomId: roomId,
              participantId: participantId,
              producers: new Map(),
              active: true,
              createdAt: new Date()
            });
          }
          
          const stream = streams.get(streamId);
          // Determine if this is audio or video producer (simplified)
          const kind = producerId.includes('audio') ? 'audio' : 'video';
          stream.producers.set(kind, { id: producerId });
        });
      });
    });
    
    return streams;
  }
}

module.exports = RoomManager;
