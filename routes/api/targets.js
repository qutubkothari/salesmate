/**
 * Targets API Routes
 * Manages sales target endpoints for salesmen
 * /api/targets
 */

const express = require('express');
const router = express.Router();
const targetService = require('../../services/targetService');
const { requireAuth } = require('../../middleware/authMiddleware');

// Middleware
router.use(requireAuth);

/**
 * POST /api/targets
 * Set or update monthly targets for a salesman
 * Body: { salesman_id, period (YYYY-MM), target_visits, target_orders, target_revenue,
 *         target_new_customers?, plant_id?, notes? }
 */
router.post('/', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { salesman_id, period, ...targetData } = req.body;

    if (!salesman_id || !period) {
      return res.status(400).json({ error: 'salesman_id and period are required' });
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.setSalesmanTargets(tenantId, salesman_id, period, targetData);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      ok: true,
      target: result.target,
      message: 'Target set successfully'
    });

  } catch (error) {
    console.error('[TARGETS_API] Create error:', error);
    res.status(500).json({ error: 'Failed to set targets' });
  }
});

/**
 * GET /api/targets/:salesman_id/:period
 * Get targets for a salesman for a specific period
 * Params: period in YYYY-MM format
 */
router.get('/:salesman_id/:period', async (req, res) => {
  try {
    const { salesman_id, period } = req.params;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.getSalesmanTargets(salesman_id, period);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      target: result.target,
      message: result.message
    });

  } catch (error) {
    console.error('[TARGETS_API] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch targets' });
  }
});

/**
 * GET /api/targets/summary
 * Get all targets for tenant in a period
 * Query: ?period=YYYY-MM (default: current month)
 */
router.get('/summary', async (req, res) => {
  try {
    const { tenantId } = req.user;
    let { period } = req.query;

    if (!period) {
      period = targetService.getCurrentPeriod();
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.getTenantTargets(tenantId, period);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      targets: result.targets,
      count: result.count,
      period,
      aggregate: result.aggregate
    });

  } catch (error) {
    console.error('[TARGETS_API] Summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

/**
 * GET /api/targets/plant/:plant_id
 * Get all targets for a plant/location
 * Query: ?period=YYYY-MM (default: current month)
 */
router.get('/plant/:plant_id', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { plant_id } = req.params;
    let { period } = req.query;

    if (!period) {
      period = targetService.getCurrentPeriod();
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.getPlantTargets(tenantId, plant_id, period);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      targets: result.targets,
      period,
      metrics: result.metrics
    });

  } catch (error) {
    console.error('[TARGETS_API] Plant targets error:', error);
    res.status(500).json({ error: 'Failed to fetch plant targets' });
  }
});

/**
 * GET /api/targets/history/:salesman_id
 * Get target history for a salesman
 * Query: ?months=3 (default: 3 months)
 */
router.get('/history/:salesman_id', async (req, res) => {
  try {
    const { salesman_id } = req.params;
    const months = parseInt(req.query.months || '3', 10);

    if (months < 1 || months > 12) {
      return res.status(400).json({ error: 'Months must be between 1 and 12' });
    }

    const result = await targetService.getSalesmanTargetHistory(salesman_id, months);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      history: result.history,
      count: result.history.length,
      months
    });

  } catch (error) {
    console.error('[TARGETS_API] History error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /api/targets/performance
 * Get performance summary for all salesmen
 * Query: ?period=YYYY-MM (default: current month)
 */
router.get('/performance', async (req, res) => {
  try {
    const { tenantId } = req.user;
    let { period } = req.query;

    if (!period) {
      period = targetService.getCurrentPeriod();
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.getTenantTargets(tenantId, period);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      performance: result.targets,
      aggregate: result.aggregate,
      period
    });

  } catch (error) {
    console.error('[TARGETS_API] Performance error:', error);
    res.status(500).json({ error: 'Failed to fetch performance' });
  }
});

/**
 * POST /api/targets/:salesman_id/achievement
 * Record visit achievement
 * Body: { period (YYYY-MM), order_created?, revenue_amount?, is_new_customer? }
 */
router.post('/:salesman_id/achievement', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { salesman_id } = req.params;
    const { period, order_created, revenue_amount, is_new_customer } = req.body;

    if (!period) {
      return res.status(400).json({ error: 'period is required' });
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.recordVisitAchievement(tenantId, salesman_id, period, {
      order_created,
      revenue_amount,
      is_new_customer
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      target: result.target,
      achievements: result.achievements,
      message: 'Achievement recorded'
    });

  } catch (error) {
    console.error('[TARGETS_API] Achievement error:', error);
    res.status(500).json({ error: 'Failed to record achievement' });
  }
});

/**
 * POST /api/targets/:salesman_id/order
 * Record order achievement
 * Body: { period (YYYY-MM), revenue_amount }
 */
router.post('/:salesman_id/order', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { salesman_id } = req.params;
    const { period, revenue_amount } = req.body;

    if (!period || revenue_amount === undefined) {
      return res.status(400).json({ error: 'period and revenue_amount are required' });
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'Period must be in YYYY-MM format' });
    }

    const result = await targetService.recordOrderAchievement(tenantId, salesman_id, period, revenue_amount);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      target: result.target,
      message: 'Order recorded'
    });

  } catch (error) {
    console.error('[TARGETS_API] Order record error:', error);
    res.status(500).json({ error: 'Failed to record order' });
  }
});

/**
 * POST /api/targets/rollover
 * Rollover targets from current month to next
 * For month-end operation
 */
router.post('/rollover', async (req, res) => {
  try {
    const { tenantId } = req.user;

    const result = await targetService.rolloverTargets(tenantId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      new_period: result.new_period,
      targets_created: result.targets_created,
      message: 'Targets rolled over successfully'
    });

  } catch (error) {
    console.error('[TARGETS_API] Rollover error:', error);
    res.status(500).json({ error: 'Failed to rollover targets' });
  }
});

module.exports = router;

