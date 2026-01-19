/**
 * Video Call Service
 * WebRTC-based video calls for customer meetings
 */

const crypto = require('crypto');
const { db } = require('./config');

class VideoCallService {
  constructor() {
    this.activeRooms = new Map();
    this.activeCalls = new Map();
  }

  /**
   * Create a video call room
   */
  async createRoom(hostUserId, participants = [], metadata = {}) {
    try {
      const roomId = this.generateRoomId();
      const joinToken = this.generateToken();

      // Create room in database
      await db.run(`
        CREATE TABLE IF NOT EXISTS video_rooms (
          id TEXT PRIMARY KEY,
          host_user_id TEXT NOT NULL,
          join_token TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          ended_at TEXT
        )
      `);

      await db.run(`
        INSERT INTO video_rooms (id, host_user_id, join_token, metadata)
        VALUES (?, ?, ?, ?)
      `, [roomId, hostUserId, joinToken, JSON.stringify(metadata)]);

      // Store in memory
      this.activeRooms.set(roomId, {
        roomId,
        hostUserId,
        participants: new Set([hostUserId]),
        startTime: Date.now(),
        metadata
      });

      return {
        success: true,
        roomId,
        joinToken,
        joinUrl: `${process.env.APP_URL || 'https://salesmate.saksolution.com'}/video/${roomId}?token=${joinToken}`,
        webrtcConfig: this.getWebRTCConfig()
      };
    } catch (error) {
      console.error('Create room error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Join a video call room
   */
  async joinRoom(roomId, userId, joinToken) {
    try {
      // Verify room exists and token is valid
      const room = await db.get(`
        SELECT * FROM video_rooms
        WHERE id = ? AND join_token = ? AND status = 'active'
      `, [roomId, joinToken]);

      if (!room) {
        return {
          success: false,
          error: 'Invalid room or token'
        };
      }

      // Add participant to active room
      const activeRoom = this.activeRooms.get(roomId);
      if (activeRoom) {
        activeRoom.participants.add(userId);
      }

      // Log participant join
      await this.logParticipant(roomId, userId, 'joined');

      return {
        success: true,
        roomId,
        hostUserId: room.host_user_id,
        participants: activeRoom ? Array.from(activeRoom.participants) : [userId],
        webrtcConfig: this.getWebRTCConfig()
      };
    } catch (error) {
      console.error('Join room error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Leave a video call room
   */
  async leaveRoom(roomId, userId) {
    try {
      const activeRoom = this.activeRooms.get(roomId);
      if (activeRoom) {
        activeRoom.participants.delete(userId);
        
        // End room if host left or no participants
        if (userId === activeRoom.hostUserId || activeRoom.participants.size === 0) {
          await this.endRoom(roomId);
        }
      }

      // Log participant leave
      await this.logParticipant(roomId, userId, 'left');

      return {
        success: true,
        roomId
      };
    } catch (error) {
      console.error('Leave room error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * End a video call room
   */
  async endRoom(roomId) {
    try {
      // Update database
      await db.run(`
        UPDATE video_rooms
        SET status = 'ended', ended_at = datetime('now')
        WHERE id = ?
      `, [roomId]);

      // Remove from active rooms
      this.activeRooms.delete(roomId);

      return {
        success: true,
        roomId
      };
    } catch (error) {
      console.error('End room error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get room status
   */
  async getRoomStatus(roomId) {
    try {
      const room = await db.get(`
        SELECT * FROM video_rooms WHERE id = ?
      `, [roomId]);

      if (!room) {
        return {
          success: false,
          error: 'Room not found'
        };
      }

      const activeRoom = this.activeRooms.get(roomId);
      const participants = activeRoom ? Array.from(activeRoom.participants) : [];

      return {
        success: true,
        roomId: room.id,
        status: room.status,
        hostUserId: room.host_user_id,
        participants,
        participantCount: participants.length,
        startTime: room.created_at,
        duration: room.ended_at ? 
          new Date(room.ended_at) - new Date(room.created_at) : 
          Date.now() - new Date(room.created_at).getTime()
      };
    } catch (error) {
      console.error('Room status error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get call history for user
   */
  async getCallHistory(userId, limit = 20) {
    try {
      const calls = await db.all(`
        SELECT 
          vr.*,
          GROUP_CONCAT(vp.user_id) as participant_list
        FROM video_rooms vr
        LEFT JOIN video_room_participants vp ON vr.id = vp.room_id
        WHERE vr.host_user_id = ? OR vp.user_id = ?
        GROUP BY vr.id
        ORDER BY vr.created_at DESC
        LIMIT ?
      `, [userId, userId, limit]);

      return {
        success: true,
        calls: calls.map(call => ({
          ...call,
          participants: call.participant_list ? call.participant_list.split(',') : []
        }))
      };
    } catch (error) {
      console.error('Call history error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log participant activity
   */
  async logParticipant(roomId, userId, action) {
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS video_room_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      await db.run(`
        INSERT INTO video_room_participants (room_id, user_id, action)
        VALUES (?, ?, ?)
      `, [roomId, userId, action]);
    } catch (error) {
      console.error('Log participant error:', error.message);
    }
  }

  /**
   * Get WebRTC configuration
   */
  getWebRTCConfig() {
    return {
      iceServers: [
        // Public STUN servers
        {
          urls: 'stun:stun.l.google.com:19302'
        },
        {
          urls: 'stun:stun1.l.google.com:19302'
        },
        // Add TURN server if configured
        ...(process.env.TURN_SERVER_URL ? [{
          urls: process.env.TURN_SERVER_URL,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL
        }] : [])
      ],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10
    };
  }

  /**
   * Generate unique room ID
   */
  generateRoomId() {
    return 'room_' + crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate join token
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      activeRooms: this.activeRooms.size,
      totalParticipants: Array.from(this.activeRooms.values())
        .reduce((sum, room) => sum + room.participants.size, 0),
      rooms: Array.from(this.activeRooms.values()).map(room => ({
        roomId: room.roomId,
        participants: room.participants.size,
        duration: Date.now() - room.startTime
      }))
    };
  }
}

module.exports = new VideoCallService();
