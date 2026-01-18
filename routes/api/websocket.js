/**
 * WebSocket API Routes
 * Real-time communication management and statistics
 */

const express = require('express');
const router = express.Router();
const websocketService = require('../../services/websocket-service');

/**
 * GET /api/websocket/stats
 * Get WebSocket statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = websocketService.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get WebSocket stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/websocket/tenants/:tenantId/connections
 * Get connected clients for a tenant
 */
router.get('/tenants/:tenantId/connections', async (req, res) => {
  try {
    const connections = websocketService.getTenantConnections(req.params.tenantId);
    res.json({ success: true, connections, count: connections.length });
  } catch (error) {
    console.error('Get tenant connections error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/websocket/tenants/:tenantId/online-salesmen
 * Get online salesmen for a tenant
 */
router.get('/tenants/:tenantId/online-salesmen', async (req, res) => {
  try {
    const onlineSalesmen = websocketService.getOnlineSalesmen(req.params.tenantId);
    res.json({ success: true, salesmen: onlineSalesmen, count: onlineSalesmen.length });
  } catch (error) {
    console.error('Get online salesmen error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/websocket/salesmen/:salesmanId/status
 * Check if salesman is online
 */
router.get('/salesmen/:salesmanId/status', async (req, res) => {
  try {
    const isOnline = websocketService.isSalesmanOnline(req.params.salesmanId);
    res.json({ success: true, salesmanId: req.params.salesmanId, isOnline });
  } catch (error) {
    console.error('Check salesman status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/websocket/emit/notification
 * Emit notification to specific salesman
 */
router.post('/emit/notification', async (req, res) => {
  try {
    const { salesmanId, notification } = req.body;
    
    if (!salesmanId || !notification) {
      return res.status(400).json({ 
        success: false, 
        error: 'salesmanId and notification are required' 
      });
    }

    websocketService.emitNotification(salesmanId, notification);
    res.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    console.error('Emit notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/websocket/emit/alert
 * Emit alert to tenant
 */
router.post('/emit/alert', async (req, res) => {
  try {
    const { tenantId, alert } = req.body;
    
    if (!tenantId || !alert) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId and alert are required' 
      });
    }

    websocketService.emitAlert(tenantId, alert);
    res.json({ success: true, message: 'Alert sent' });
  } catch (error) {
    console.error('Emit alert error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/websocket/emit/dashboard-refresh
 * Trigger dashboard refresh for a tenant
 */
router.post('/emit/dashboard-refresh', async (req, res) => {
  try {
    const { tenantId, data } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId is required' 
      });
    }

    websocketService.emitDashboardRefresh(tenantId, data || {});
    res.json({ success: true, message: 'Dashboard refresh triggered' });
  } catch (error) {
    console.error('Emit dashboard refresh error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/websocket/broadcast
 * Broadcast message to all connected clients
 */
router.post('/broadcast', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    if (!event) {
      return res.status(400).json({ 
        success: false, 
        error: 'event is required' 
      });
    }

    websocketService.broadcast(event, data);
    res.json({ success: true, message: 'Message broadcasted' });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
