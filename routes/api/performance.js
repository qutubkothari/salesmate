/**
 * Performance & Scale API Routes
 * Caching, query optimization, rate limiting, health monitoring, metrics
 */

const express = require('express');
const router = express.Router();
const PerformanceService = require('../../services/performance-service');

// ===== CACHING =====

/**
 * GET /api/performance/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', async (req, res) => {
  try {
    const stats = await PerformanceService.getCacheStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    console.error('Get cache stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/cache/:key
 * Get cached value
 */
router.get('/cache/:key', async (req, res) => {
  try {
    const value = await PerformanceService.getCache(req.params.key);
    
    if (value === null) {
      return res.status(404).json({ success: false, message: 'Cache miss' });
    }
    
    res.json({ success: true, value, source: 'cache' });
  } catch (error) {
    console.error('Get cache error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/cache
 * Set cache value
 */
router.post('/cache', async (req, res) => {
  try {
    const { key, value, ttl, type, priority, canEvict } = req.body;
    
    await PerformanceService.setCache(key, value, { ttl, type, priority, canEvict });
    
    res.json({ success: true, message: 'Cache set successfully' });
  } catch (error) {
    console.error('Set cache error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/cache/evict
 * Manually trigger cache eviction
 */
router.post('/cache/evict', async (req, res) => {
  try {
    PerformanceService.evictCache();
    res.json({ success: true, message: 'Cache eviction completed' });
  } catch (error) {
    console.error('Cache eviction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/performance/cache/:keyOrPattern
 * Invalidate cache
 */
router.delete('/cache/:keyOrPattern', async (req, res) => {
  try {
    await PerformanceService.invalidateCache(req.params.keyOrPattern);
    res.json({ success: true, message: 'Cache invalidated' });
  } catch (error) {
    console.error('Invalidate cache error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== QUERY PERFORMANCE =====

/**
 * POST /api/performance/query/track
 * Track query performance
 */
router.post('/query/track', async (req, res) => {
  try {
    const result = PerformanceService.trackQuery(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Track query error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/query/slow
 * Get slow queries report
 */
router.get('/query/slow', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const queries = PerformanceService.getSlowQueries(limit);
    res.json({ success: true, data: queries, count: queries.length });
  } catch (error) {
    console.error('Get slow queries error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/query/optimize
 * Suggest query optimization
 */
router.post('/query/optimize', async (req, res) => {
  try {
    const result = PerformanceService.suggestOptimization(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Suggest optimization error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== RATE LIMITING =====

/**
 * POST /api/performance/rate-limit/check
 * Check rate limit
 */
router.post('/rate-limit/check', async (req, res) => {
  try {
    const { limitType, limitKey, maxRequests, windowSeconds } = req.body;
    
    const result = PerformanceService.checkRateLimit(
      limitType, limitKey, maxRequests, windowSeconds
    );
    
    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        ...result
      });
    }
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Rate limit check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== API METRICS =====

/**
 * GET /api/performance/metrics
 * Get metrics (alias for /metrics/api)
 */
router.get('/metrics', async (req, res) => {
  try {
    const { tenantId, startDate, endDate } = req.query;
    const metrics = PerformanceService.getApiMetrics(startDate, endDate);
    res.json({ success: true, ...metrics });
  } catch (error) {
    console.error('Get metrics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/metrics/track
 * Track API request
 */
router.post('/metrics/track', async (req, res) => {
  try {
    const result = PerformanceService.trackApiRequest(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Track API metrics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/metrics/api
 * Get API performance metrics
 */
router.get('/metrics/api', async (req, res) => {
  try {
    const { startDate, endDate, endpoint } = req.query;
    
    const metrics = PerformanceService.getApiMetrics(startDate, endDate, endpoint);
    
    res.json({ success: true, data: metrics, count: metrics.length });
  } catch (error) {
    console.error('Get API metrics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== HEALTH CHECKS =====

/**
 * GET /api/performance/health
 * Quick health check (alias for /health/status)
 */
router.get('/health', async (req, res) => {
  try {
    const health = await PerformanceService.getHealthStatus();
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    // Add quick database check
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || './local-database.db';
    const testDb = new Database(dbPath);
    const dbStatus = testDb.prepare('SELECT 1 as test').get() ? 'connected' : 'disconnected';
    testDb.close();
    
    res.json({ 
      success: true, 
      status: health.overall,
      uptime: Math.round(uptime),
      database: { status: dbStatus },
      memory: {
        used: Math.round(memory.heapUsed / 1024 / 1024),
        total: Math.round(memory.heapTotal / 1024 / 1024)
      },
      checks: health.checks
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/health/check
 * Run health check
 */
router.post('/health/check', async (req, res) => {
  try {
    const result = PerformanceService.runHealthCheck(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/health/status
 * Get system health status
 */
router.get('/health/status', async (req, res) => {
  try {
    const status = PerformanceService.getHealthStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Get health status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== PERFORMANCE ALERTS =====

/**
 * POST /api/performance/alerts
 * Create performance alert
 */
router.post('/alerts', async (req, res) => {
  try {
    const result = PerformanceService.createAlert(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/alerts
 * Get active alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const { severity } = req.query;
    const alerts = PerformanceService.getActiveAlerts(severity);
    res.json({ success: true, data: alerts, count: alerts.length });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/performance/alerts/:alertId/acknowledge
 * Acknowledge alert
 */
router.put('/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    const { acknowledgedBy } = req.body;
    PerformanceService.acknowledgeAlert(req.params.alertId, acknowledgedBy);
    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (error) {
    console.error('Acknowledge alert error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/performance/alerts/:alertId/resolve
 * Resolve alert
 */
router.put('/alerts/:alertId/resolve', async (req, res) => {
  try {
    const { resolutionNotes } = req.body;
    PerformanceService.resolveAlert(req.params.alertId, resolutionNotes);
    res.json({ success: true, message: 'Alert resolved' });
  } catch (error) {
    console.error('Resolve alert error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
