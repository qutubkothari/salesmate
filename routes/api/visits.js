/**
 * Visits API Routes
 * Manages field visit endpoints for salesmen
 * /api/visits
 */

const express = require('express');
const router = express.Router();
const visitService = require('../../services/visitService');
const orderService = require('../../services/orderService');
const conversationLinkingService = require('../../services/conversationLinkingService');
const targetSyncService = require('../../services/targetSyncService');
const { requireAuth } = require('../../middleware/authMiddleware');

// Middleware
router.use(requireAuth);

/**
 * POST /api/visits
 * Create a new visit
 * Body: { customer_id?, customer_name, contact_person?, customer_phone?, visit_type?, 
 *         meeting_types?, products_discussed?, potential?, competitor_name?, can_be_switched?,
 *         remarks?, next_action?, next_action_date?, gps_latitude?, gps_longitude?, plant_id? }
 */
router.post('/', async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { salesman_id, ...visitData } = req.body;

    // Only salesman can create their own visits
    if (userId !== salesman_id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot create visits for other salesmen' });
    }

    const result = await visitService.createVisit(tenantId, salesman_id || userId, visitData);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      ok: true,
      visit: result.visit,
      visit_id: result.visit_id,
      message: 'Visit created successfully'
    });

  } catch (error) {
    console.error('[VISITS_API] Create error:', error);
    res.status(500).json({ error: 'Failed to create visit' });
  }
});

/**
 * GET /api/visits/:salesman_id
 * Get all visits for a salesman
 * Query: ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&completed_only=true&pending_only=true
 */
router.get('/:salesman_id', async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { salesman_id } = req.params;
    const filters = req.query;

    // Salesman can only view their own visits
    if (role === 'salesman' && userId !== salesman_id) {
      return res.status(403).json({ error: 'Cannot view other salesmen visits' });
    }

    const result = await visitService.getSalesmanVisits(tenantId, salesman_id, filters);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      visits: result.visits,
      count: result.count
    });

  } catch (error) {
    console.error('[VISITS_API] Get visits error:', error);
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

/**
 * GET /api/visits/detail/:visit_id
 * Get complete visit details
 */
router.get('/detail/:visit_id', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { visit_id } = req.params;

    const result = await visitService.getVisit(visit_id);

    if (!result.ok) {
      return res.status(404).json({ error: result.error });
    }

    // Verify tenant access
    if (result.visit.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      ok: true,
      visit: result.visit
    });

  } catch (error) {
    console.error('[VISITS_API] Get detail error:', error);
    res.status(500).json({ error: 'Failed to fetch visit' });
  }
});

/**
 * PUT /api/visits/:visit_id/complete
 * Mark visit as completed
 * Body: { time_out?, remarks?, next_action_date?, final_status? }
 * Phase 2: Auto-creates order from products discussed, links to conversation, records achievement
 */
router.put('/:visit_id/complete', async (req, res) => {
  try {
    const { visit_id } = req.params;
    const { tenantId, userId } = req.user;
    const completionData = req.body;

    // 1. Complete the visit
    const visitResult = await visitService.completeVisit(visit_id, completionData);

    if (!visitResult.ok) {
      return res.status(400).json({ error: visitResult.error });
    }

    const visit = visitResult.visit;
    const autoActions = {
      order_created: false,
      conversation_linked: false,
      target_synced: false
    };

    // 2. Auto-create order if products were discussed
    if (visit.products_discussed && visit.products_discussed.length > 0) {
      console.log('[VISITS_API] Auto-creating order from visit products');
      
      const orderResult = await orderService.createOrderFromVisit(tenantId, visit_id);
      if (orderResult.ok) {
        autoActions.order_created = true;
        autoActions.order_id = orderResult.order_id;
      } else {
        console.error('[VISITS_API] Failed to create order:', orderResult.error);
      }
    }

    // 3. Link visit to customer conversation
    if (visit.customer_id) {
      console.log('[VISITS_API] Linking visit to conversation');
      
      const linkResult = await conversationLinkingService.linkVisitToConversation(
        tenantId,
        visit.customer_id,
        visit_id
      );
      
      if (linkResult.ok) {
        autoActions.conversation_linked = true;
      } else {
        console.error('[VISITS_API] Failed to link conversation:', linkResult.error);
      }
    }

    // 4. Sync targets to conversation for AI context
    if (visit.customer_id) {
      console.log('[VISITS_API] Syncing targets to conversation');
      
      const syncResult = await targetSyncService.syncTargetsToConversation(
        tenantId,
        visit.customer_id
      );
      
      if (syncResult.ok) {
        autoActions.target_synced = true;
      }
    }

    res.json({
      ok: true,
      visit: visit,
      duration_minutes: visitResult.duration_minutes,
      auto_actions: autoActions,
      message: 'Visit completed successfully with auto-actions'
    });

  } catch (error) {
    console.error('[VISITS_API] Complete error:', error);
    res.status(500).json({ error: 'Failed to complete visit' });
  }
});

/**
 * POST /api/visits/:visit_id/location
 * Update GPS location during visit
 * Body: { latitude, longitude, accuracy? }
 */
router.post('/:visit_id/location', async (req, res) => {
  try {
    const { visit_id } = req.params;
    const { latitude, longitude, accuracy } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const result = await visitService.updateVisitLocation(visit_id, latitude, longitude, accuracy);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      visit: result.visit,
      message: 'Location updated'
    });

  } catch (error) {
    console.error('[VISITS_API] Location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * POST /api/visits/:visit_id/images
 * Add images to visit
 * Body: { images: [{ url: string, caption?: string }] }
 */
router.post('/:visit_id/images', async (req, res) => {
  try {
    const { visit_id } = req.params;
    const { images } = req.body;

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Images array is required' });
    }

    const result = await visitService.addVisitImages(visit_id, images);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      ok: true,
      images: result.images,
      count: result.images.length,
      message: 'Images added successfully'
    });

  } catch (error) {
    console.error('[VISITS_API] Images error:', error);
    res.status(500).json({ error: 'Failed to add images' });
  }
});

/**
 * GET /api/visits/today
 * Get today's visits overview
 */
router.get('/today', async (req, res) => {
  try {
    const { tenantId } = req.user;

    const result = await visitService.getTodayVisits(tenantId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      visits: result.visits,
      metrics: result.metrics
    });

  } catch (error) {
    console.error('[VISITS_API] Today error:', error);
    res.status(500).json({ error: 'Failed to fetch today visits' });
  }
});

/**
 * GET /api/visits/pending
 * Get pending visits (not completed)
 * Query: ?salesman_id=
 */
router.get('/pending', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { salesman_id } = req.query;

    const result = await visitService.getPendingVisits(tenantId, salesman_id);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      pending_visits: result.pending_visits,
      count: result.count
    });

  } catch (error) {
    console.error('[VISITS_API] Pending error:', error);
    res.status(500).json({ error: 'Failed to fetch pending visits' });
  }
});

/**
 * GET /api/visits/search
 * Search visits
 * Query: ?q=search_term
 */
router.get('/search', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    const result = await visitService.searchVisits(tenantId, q);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      visits: result.visits,
      count: result.count
    });

  } catch (error) {
    console.error('[VISITS_API] Search error:', error);
    res.status(500).json({ error: 'Failed to search visits' });
  }
});

/**
 * GET /api/visits/customer/:customer_id
 * Get all visits for a customer
 */
router.get('/customer/:customer_id', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { customer_id } = req.params;

    const result = await visitService.getCustomerVisits(tenantId, customer_id);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      visits: result.visits,
      visit_count: result.visit_count
    });

  } catch (error) {
    console.error('[VISITS_API] Customer visits error:', error);
    res.status(500).json({ error: 'Failed to fetch customer visits' });
  }
});

/**
 * GET /api/visits/summary/:date
 * Get daily visit summary
 * Params: date in YYYY-MM-DD format
 */
router.get('/summary/:date', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const result = await visitService.getDailyVisitSummary(tenantId, date);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      summary: result.summary,
      date
    });

  } catch (error) {
    console.error('[VISITS_API] Summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

module.exports = router;

