/**
 * Unified Users API Routes
 * Manages salesman/field staff endpoints
 * Merges FSM salesman operations with Salesmate user operations
 * /api/users/salesmen
 */

const express = require('express');
const router = express.Router();
const unifiedUserService = require('../../services/unifiedUserService');
const { requireAuth } = require('../../middleware/authMiddleware');

// Middleware
router.use(requireAuth);

/**
 * POST /api/users/salesman
 * Create a new salesman (field staff) with user record
 * Body: { name, phone, email?, plant_id? }
 */
router.post('/salesman', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { name, phone, email, plant_id } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const result = await unifiedUserService.createSalesman(tenantId, {
      name,
      phone,
      email,
      plant_id
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      ok: true,
      user_id: result.user_id,
      salesman_id: result.salesman_id,
      message: result.message
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Create error:', error);
    res.status(500).json({ error: 'Failed to create salesman' });
  }
});

/**
 * GET /api/users/salesmen
 * Get all salesmen for tenant
 * Query: ?active_only=true
 */
router.get('/salesmen', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const activeOnly = req.query.active_only !== 'false';

    const result = await unifiedUserService.getSalesmenForTenant(tenantId, activeOnly);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      salesmen: result.salesmen,
      count: result.count
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Get salesmen error:', error);
    res.status(500).json({ error: 'Failed to fetch salesmen' });
  }
});

/**
 * GET /api/users/:user_id/context
 * Get user with full context (user info + salesman info if applicable)
 */
router.get('/:user_id/context', async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await unifiedUserService.getUserWithContext(user_id);

    if (!result.ok) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      ok: true,
      user: result.user
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Get context error:', error);
    res.status(500).json({ error: 'Failed to fetch user context' });
  }
});

/**
 * PUT /api/users/:user_id
 * Update user basic info
 * Body: { name?, email?, phone?, is_active?, salesman_info?: { plant_id? } }
 */
router.put('/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const updateData = req.body;

    const result = await unifiedUserService.updateUser(user_id, updateData);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      user: result.user,
      message: 'User updated'
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Update error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * POST /api/users/:salesman_id/location
 * Update salesman GPS location
 * Body: { latitude, longitude, accuracy? }
 */
router.post('/:salesman_id/location', async (req, res) => {
  try {
    const { salesman_id } = req.params;
    const { latitude, longitude, accuracy } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const result = await unifiedUserService.updateSalesmanLocation(salesman_id, latitude, longitude, accuracy);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      salesman: result.salesman,
      message: 'Location updated'
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * GET /api/users/team-overview
 * Get team statistics and overview
 */
router.get('/team-overview', async (req, res) => {
  try {
    const { tenantId } = req.user;

    const result = await unifiedUserService.getTeamOverview(tenantId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      overview: result.overview
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Team overview error:', error);
    res.status(500).json({ error: 'Failed to fetch team overview' });
  }
});

/**
 * GET /api/users/:salesman_id/performance
 * Get salesman performance for a period
 * Query: ?period=YYYY-MM (default: current month)
 */
router.get('/:salesman_id/performance', async (req, res) => {
  try {
    const { salesman_id } = req.params;
    let { period } = req.query;

    if (!period) {
      const now = new Date();
      period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const result = await unifiedUserService.getSalesmanPerformance(salesman_id, period);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      performance: result.performance,
      period
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Performance error:', error);
    res.status(500).json({ error: 'Failed to fetch performance' });
  }
});

/**
 * PUT /api/users/:salesman_id/deactivate
 * Deactivate a salesman (soft delete)
 */
router.put('/:salesman_id/deactivate', async (req, res) => {
  try {
    const { salesman_id } = req.params;

    const result = await unifiedUserService.deactivateSalesman(salesman_id);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      message: result.message
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Deactivate error:', error);
    res.status(500).json({ error: 'Failed to deactivate salesman' });
  }
});

/**
 * POST /api/users/salesman/:salesman_id/activity
 * Log field activity for audit trail
 * Body: { activity_type, activity_data?: {} }
 */
router.post('/salesman/:salesman_id/activity', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { salesman_id } = req.params;
    const { activity_type, activity_data } = req.body;

    if (!activity_type) {
      return res.status(400).json({ error: 'activity_type is required' });
    }

    const result = await unifiedUserService.logFieldActivity(tenantId, salesman_id, activity_type, activity_data);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      message: 'Activity logged'
    });

  } catch (error) {
    console.error('[UNIFIED_USERS_API] Activity log error:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

module.exports = router;
