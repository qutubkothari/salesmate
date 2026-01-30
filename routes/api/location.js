/**
 * Location API
 * Handles GPS tracking, check-ins, and route optimization for salesmen
 */

const express = require('express');
const router = express.Router();
const { requireSalesmanAuth } = require('../../services/salesmanAuth');
const locationService = require('../../services/locationService');

/**
 * POST /api/location/record
 * Record salesman's current location
 */
router.post('/record', requireSalesmanAuth, async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    const { salesmanId, tenantId } = req.salesmanAuth;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: 'Latitude and longitude are required'
      });
    }

    const result = await locationService.recordLocation(
      salesmanId,
      tenantId,
      parseFloat(latitude),
      parseFloat(longitude),
      accuracy ? parseFloat(accuracy) : null
    );

    res.json(result);
  } catch (err) {
    console.error('[LOCATION API] Record error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/location/check-in
 * Check in at a customer location
 */
router.post('/check-in', requireSalesmanAuth, async (req, res) => {
  try {
    const {
      customerId,
      latitude,
      longitude,
      accuracy,
      address,
      visitType,
      conversationId
    } = req.body;
    const { salesmanId, tenantId } = req.salesmanAuth;

    if (!customerId || !latitude || !longitude || !visitType) {
      return res.status(400).json({
        success: false,
        error: 'customerId, latitude, longitude, and visitType are required'
      });
    }

    const location = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: accuracy ? parseFloat(accuracy) : null,
      address
    };

    const result = await locationService.checkIn(
      salesmanId,
      customerId,
      tenantId,
      location,
      visitType,
      conversationId
    );

    res.json(result);
  } catch (err) {
    console.error('[LOCATION API] Check-in error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/location/check-out
 * Check out from a customer location
 */
router.post('/check-out', requireSalesmanAuth, async (req, res) => {
  try {
    const { visitId, latitude, longitude, accuracy, notes, outcome } = req.body;

    if (!visitId || !latitude || !longitude || !outcome) {
      return res.status(400).json({
        success: false,
        error: 'visitId, latitude, longitude, and outcome are required'
      });
    }

    const location = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: accuracy ? parseFloat(accuracy) : null
    };

    const result = await locationService.checkOut(visitId, location, notes, outcome);

    res.json(result);
  } catch (err) {
    console.error('[LOCATION API] Check-out error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/location/visits
 * Get visit history for the salesman
 */
router.get('/visits', requireSalesmanAuth, async (req, res) => {
  try {
    const { salesmanId } = req.salesmanAuth;
    const days = req.query.days ? parseInt(req.query.days) : 30;

    const result = await locationService.getVisitHistory(salesmanId, days);

    res.json(result);
  } catch (err) {
    console.error('[LOCATION API] Visits error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/location/optimize-route
 * Optimize route for a list of customers
 */
router.post('/optimize-route', requireSalesmanAuth, async (req, res) => {
  try {
    const { customerIds, startLatitude, startLongitude, routeDate } = req.body;
    const { salesmanId, tenantId } = req.salesmanAuth;

    if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'customerIds array is required'
      });
    }

    if (!startLatitude || !startLongitude) {
      return res.status(400).json({
        success: false,
        error: 'startLatitude and startLongitude are required'
      });
    }

    const startLocation = {
      latitude: parseFloat(startLatitude),
      longitude: parseFloat(startLongitude)
    };

    const routeData = await locationService.optimizeRoute(
      salesmanId,
      tenantId,
      customerIds,
      startLocation
    );

    // If routeDate provided, save the route
    if (routeDate) {
      await locationService.saveRoute(salesmanId, tenantId, new Date(routeDate), routeData);
    }

    res.json(routeData);
  } catch (err) {
    console.error('[LOCATION API] Optimize route error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/location/route
 * Get today's route for the salesman
 */
router.get('/route', requireSalesmanAuth, async (req, res) => {
  try {
    const { salesmanId } = req.salesmanAuth;
    const date = req.query.date ? new Date(req.query.date) : new Date();

    const result = await locationService.getRoute(salesmanId, date);

    res.json(result);
  } catch (err) {
    console.error('[LOCATION API] Get route error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * PUT /api/location/route/:routeId/start
 * Mark route as started
 */
router.put('/route/:routeId/start', requireSalesmanAuth, async (req, res) => {
  try {
    const { routeId } = req.params;
    const { dbClient } = require('../../services/config');

    const result = await dbClient.query(
      `UPDATE daily_routes 
       SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND salesman_id = $2
       RETURNING id, status, started_at`,
      [routeId, req.salesmanAuth.salesmanId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Route not found'
      });
    }

    res.json({
      success: true,
      route: result.rows[0]
    });
  } catch (err) {
    console.error('[LOCATION API] Start route error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * PUT /api/location/route/:routeId/complete
 * Mark route as completed
 */
router.put('/route/:routeId/complete', requireSalesmanAuth, async (req, res) => {
  try {
    const { routeId } = req.params;
    const { dbClient } = require('../../services/config');

    const result = await dbClient.query(
      `UPDATE daily_routes 
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND salesman_id = $2
       RETURNING id, status, completed_at`,
      [routeId, req.salesmanAuth.salesmanId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Route not found'
      });
    }

    res.json({
      success: true,
      route: result.rows[0]
    });
  } catch (err) {
    console.error('[LOCATION API] Complete route error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
