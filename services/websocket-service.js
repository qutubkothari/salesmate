/**
 * WebSocket Service
 * Real-time bidirectional communication using Socket.IO
 */

const { Server } = require('socket.io');
const { db } = require('./config');

class WebSocketService {
  constructor() {
    this.io = null;
    this.connections = new Map(); // tenantId -> Set of socket IDs
    this.salesmanSockets = new Map(); // salesmanId -> Set of socket IDs
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0
    };
  }

  /**
   * Initialize Socket.IO server
   */
  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*", // Configure based on your requirements
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    console.log('✅ WebSocket service initialized');
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.stats.totalConnections++;
      this.stats.activeConnections++;
      
      console.log(`[WS] Client connected: ${socket.id}`);

      // Authentication
      socket.on('authenticate', (data) => {
        this.handleAuthentication(socket, data);
      });

      // Salesman location updates
      socket.on('location:update', (data) => {
        this.handleLocationUpdate(socket, data);
      });

      // Join tenant room
      socket.on('join:tenant', (tenantId) => {
        this.handleJoinTenant(socket, tenantId);
      });

      // Join salesman room
      socket.on('join:salesman', (salesmanId) => {
        this.handleJoinSalesman(socket, salesmanId);
      });

      // Typing indicators for chat
      socket.on('typing', (data) => {
        socket.to(data.room).emit('typing', { userId: data.userId, isTyping: true });
      });

      socket.on('stop-typing', (data) => {
        socket.to(data.room).emit('typing', { userId: data.userId, isTyping: false });
      });

      // Disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
        this.stats.activeConnections--;
        console.log(`[WS] Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Handle client authentication
   */
  handleAuthentication(socket, data) {
    const { tenantId, salesmanId, userId } = data;
    
    socket.data = {
      tenantId,
      salesmanId,
      userId,
      authenticated: true,
      connectedAt: new Date()
    };

    // Join tenant room
    if (tenantId) {
      this.handleJoinTenant(socket, tenantId);
    }

    // Join salesman room
    if (salesmanId) {
      this.handleJoinSalesman(socket, salesmanId);
    }

    socket.emit('authenticated', { success: true });
    console.log(`[WS] Client authenticated: tenant=${tenantId}, salesman=${salesmanId}`);
  }

  /**
   * Handle joining tenant room
   */
  handleJoinTenant(socket, tenantId) {
    const room = `tenant:${tenantId}`;
    socket.join(room);
    
    if (!this.connections.has(tenantId)) {
      this.connections.set(tenantId, new Set());
    }
    this.connections.get(tenantId).add(socket.id);

    socket.emit('joined:tenant', { tenantId, room });
    console.log(`[WS] Socket ${socket.id} joined tenant room: ${tenantId}`);
  }

  /**
   * Handle joining salesman room
   */
  handleJoinSalesman(socket, salesmanId) {
    const room = `salesman:${salesmanId}`;
    socket.join(room);
    
    if (!this.salesmanSockets.has(salesmanId)) {
      this.salesmanSockets.set(salesmanId, new Set());
    }
    this.salesmanSockets.get(salesmanId).add(socket.id);

    socket.emit('joined:salesman', { salesmanId, room });
    console.log(`[WS] Socket ${socket.id} joined salesman room: ${salesmanId}`);
  }

  /**
   * Handle location updates
   */
  handleLocationUpdate(socket, data) {
    const { salesmanId, latitude, longitude, accuracy, timestamp } = data;
    
    // Broadcast to tenant
    if (socket.data?.tenantId) {
      this.io.to(`tenant:${socket.data.tenantId}`).emit('location:updated', {
        salesmanId,
        latitude,
        longitude,
        accuracy,
        timestamp
      });
    }

    // Save to database
    try {
      db.prepare(`
        UPDATE salesmen 
        SET last_known_latitude = ?, last_known_longitude = ?, location_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(latitude, longitude, salesmanId);
    } catch (error) {
      console.error('[WS] Failed to save location update:', error);
    }
  }

  /**
   * Handle disconnect
   */
  handleDisconnect(socket) {
    // Remove from tenant connections
    if (socket.data?.tenantId) {
      const tenantSockets = this.connections.get(socket.data.tenantId);
      if (tenantSockets) {
        tenantSockets.delete(socket.id);
        if (tenantSockets.size === 0) {
          this.connections.delete(socket.data.tenantId);
        }
      }
    }

    // Remove from salesman connections
    if (socket.data?.salesmanId) {
      const salesmanSockets = this.salesmanSockets.get(socket.data.salesmanId);
      if (salesmanSockets) {
        salesmanSockets.delete(socket.id);
        if (salesmanSockets.size === 0) {
          this.salesmanSockets.delete(socket.data.salesmanId);
        }
      }
    }
  }

  // ===== EMIT METHODS =====

  /**
   * Emit visit created notification
   */
  emitVisitCreated(visit, tenantId) {
    this.io.to(`tenant:${tenantId}`).emit('visit:created', visit);
    this.stats.messagesSent++;
  }

  /**
   * Emit visit updated notification
   */
  emitVisitUpdated(visit, tenantId) {
    this.io.to(`tenant:${tenantId}`).emit('visit:updated', visit);
    this.stats.messagesSent++;
  }

  /**
   * Emit order created notification
   */
  emitOrderCreated(order, tenantId) {
    this.io.to(`tenant:${tenantId}`).emit('order:created', order);
    this.stats.messagesSent++;
  }

  /**
   * Emit target progress update
   */
  emitTargetProgress(salesmanId, tenantId, progress) {
    this.io.to(`salesman:${salesmanId}`).emit('target:progress', progress);
    this.io.to(`tenant:${tenantId}`).emit('target:progress', progress);
    this.stats.messagesSent++;
  }

  /**
   * Emit dashboard refresh (for real-time analytics)
   */
  emitDashboardRefresh(tenantId, data) {
    this.io.to(`tenant:${tenantId}`).emit('dashboard:refresh', data);
    this.stats.messagesSent++;
  }

  /**
   * Emit notification to specific salesman
   */
  emitNotification(salesmanId, notification) {
    this.io.to(`salesman:${salesmanId}`).emit('notification', notification);
    this.stats.messagesSent++;
  }

  /**
   * Emit alert to tenant
   */
  emitAlert(tenantId, alert) {
    this.io.to(`tenant:${tenantId}`).emit('alert', alert);
    this.stats.messagesSent++;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(event, data) {
    this.io.emit(event, data);
    this.stats.messagesSent++;
  }

  /**
   * Get WebSocket statistics
   */
  getStats() {
    return {
      ...this.stats,
      tenants: this.connections.size,
      salesmen: this.salesmanSockets.size,
      rooms: this.io?.sockets.adapter.rooms.size || 0
    };
  }

  /**
   * Get connected clients for a tenant
   */
  getTenantConnections(tenantId) {
    const sockets = this.connections.get(tenantId);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Check if salesman is online
   */
  isSalesmanOnline(salesmanId) {
    const sockets = this.salesmanSockets.get(salesmanId);
    return sockets && sockets.size > 0;
  }

  /**
   * Get all online salesmen for a tenant
   */
  getOnlineSalesmen(tenantId) {
    const connections = this.connections.get(tenantId);
    if (!connections) return [];

    const onlineSalesmen = new Set();
    connections.forEach(socketId => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.data?.salesmanId) {
        onlineSalesmen.add(socket.data.salesmanId);
      }
    });

    return Array.from(onlineSalesmen);
  }
}

// Singleton instance
module.exports = new WebSocketService();
