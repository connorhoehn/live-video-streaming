// Room-related WebSocket events
module.exports = (roomManager, routerManager, router, nodeId) => {
  return {
    'join-room': async (socket, { roomId, participantId, displayName }) => {
      try {
        // Get or create room
        let room = roomManager.getRoom(roomId);
        
        if (!room) {
          room = await roomManager.createRoom({ 
            roomId: roomId,
            metadata: { name: roomId } 
          });
          console.log(`🏠 Room ${roomId} created by ${participantId}`);
        }
        
        // Add participant to room
        await roomManager.joinRoom(roomId, participantId, { 
          metadata: { displayName, socketId: socket.id } 
        });
        
        // Join socket room
        socket.join(`room:${roomId}`);
        
        // Get router capabilities
        const routerId = roomManager.getRoomRouterId(roomId);
        const routerRtpCapabilities = routerManager.getRouter(routerId)?.rtpCapabilities ||
                                    router.rtpCapabilities;
        
        socket.emit('room-joined', {
          roomId,
          participantId,
          routerRtpCapabilities,
          nodeId: nodeId, // Add node information
          nodeInfo: {
            id: nodeId,
            port: process.env.SFU_PORT || 3001,
            host: 'localhost'
          }
        });
        
        // Notify room participants
        socket.to(`room:${roomId}`).emit('participant-joined', {
          roomId,
          participantId,
          metadata: { displayName }
        });
        
      } catch (error) {
        console.error(`❌ Error joining room:`, error);
        socket.emit('error', { message: error.message });
      }
    },

    'leave-room': async (socket, { roomId, participantId }) => {
      try {
        await roomManager.removeParticipant(roomId, participantId);
        socket.leave(`room:${roomId}`);
        
        // Notify room participants
        socket.to(`room:${roomId}`).emit('participant-left', {
          roomId,
          participantId
        });
        
        console.log(`👋 Participant ${participantId} left room ${roomId}`);
      } catch (error) {
        console.error(`❌ Error leaving room:`, error);
      }
    },

    'get-room-participants': async (socket, { roomId }) => {
      try {
        const participants = await roomManager.getRoomParticipants(roomId);
        socket.emit('room-participants', {
          roomId,
          participants
        });
      } catch (error) {
        console.error(`❌ Error getting room participants:`, error);
        socket.emit('error', { message: error.message });
      }
    },

    'room-message': async (socket, { roomId, message, participantId }) => {
      try {
        const participant = await roomManager.getParticipant(roomId, participantId);
        if (participant) {
          // Broadcast message to all room participants
          socket.to(`room:${roomId}`).emit('room-message', {
            roomId,
            message,
            participantId,
            displayName: participant.metadata?.displayName,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`❌ Error sending room message:`, error);
        socket.emit('error', { message: error.message });
      }
    },

    'update-participant-metadata': async (socket, { roomId, participantId, metadata }) => {
      try {
        await roomManager.updateParticipantMetadata(roomId, participantId, metadata);
        
        // Notify room participants
        socket.to(`room:${roomId}`).emit('participant-updated', {
          roomId,
          participantId,
          metadata
        });
      } catch (error) {
        console.error(`❌ Error updating participant metadata:`, error);
        socket.emit('error', { message: error.message });
      }
    },

    'get-room-info': async (socket, { roomId }) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (room) {
          const participants = await roomManager.getRoomParticipants(roomId);
          socket.emit('room-info', {
            roomId,
            metadata: room.metadata,
            participantCount: participants.length,
            participants
          });
        } else {
          socket.emit('room-info', {
            roomId,
            exists: false
          });
        }
      } catch (error) {
        console.error(`❌ Error getting room info:`, error);
        socket.emit('error', { message: error.message });
      }
    },
  };
};
