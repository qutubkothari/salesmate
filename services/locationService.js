/**
 * Location Service
 * Handles GPS tracking, check-ins, route optimization, and geo-fencing
 */

const { dbClient } = require('./config');

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Record salesman location
 * @param {string} salesmanId - Salesman UUID
 * @param {string} tenantId - Tenant UUID
 * @param {number} latitude - GPS latitude
 * @param {number} longitude - GPS longitude
 * @param {number} accuracy - GPS accuracy in meters
 */
async function recordLocation(salesmanId, tenantId, latitude, longitude, accuracy = null) {
  try {
    const query = `
      INSERT INTO salesman_locations (salesman_id, tenant_id, latitude, longitude, accuracy)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, recorded_at
    `;

    const result = await dbClient.query(query, [
      salesmanId,
      tenantId,
      latitude,
      longitude,
      accuracy
    ]);

    return {
      success: true,
      locationId: result.rows[0].id,
      recordedAt: result.rows[0].recorded_at
    };
  } catch (err) {
    console.error('[LOCATION] Error recording location:', err.message);
    throw err;
  }
}

/**
 * Check in at a customer location
 * @param {string} salesmanId - Salesman UUID
 * @param {string} customerId - Customer UUID
 * @param {string} tenantId - Tenant UUID
 * @param {object} location - {latitude, longitude, accuracy, address}
 * @param {string} visitType - Visit type
 * @param {string} conversationId - Optional conversation ID for follow-ups
 */
async function checkIn(salesmanId, customerId, tenantId, location, visitType, conversationId = null) {
  try {
    // Get customer's location
    const customerQuery = `
      SELECT latitude, longitude, name
      FROM customer_profiles_new
      WHERE id = $1 AND tenant_id = $2
    `;
    const customerResult = await dbClient.query(customerQuery, [customerId, tenantId]);

    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }

    const customer = customerResult.rows[0];
    let distanceFromCustomer = null;

    // Calculate distance if customer has location
    if (customer.latitude && customer.longitude) {
      distanceFromCustomer = calculateDistance(
        location.latitude,
        location.longitude,
        customer.latitude,
        customer.longitude
      );
    }

    // Check geo-fence rules
    const geoFenceValid = await validateGeoFence(tenantId, distanceFromCustomer);

    if (!geoFenceValid.valid) {
      console.warn('[LOCATION] Geo-fence validation failed:', geoFenceValid.reason);
      // Still allow check-in but flag it
    }

    // Create visit record
    const visitQuery = `
      INSERT INTO customer_visits (
        salesman_id, customer_id, tenant_id, visit_type,
        check_in_time, check_in_latitude, check_in_longitude, check_in_accuracy, check_in_address,
        distance_from_customer, conversation_id
      )
      VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10)
      RETURNING id, check_in_time
    `;

    const visitResult = await dbClient.query(visitQuery, [
      salesmanId,
      customerId,
      tenantId,
      visitType,
      location.latitude,
      location.longitude,
      location.accuracy,
      location.address,
      distanceFromCustomer,
      conversationId
    ]);

    return {
      success: true,
      visitId: visitResult.rows[0].id,
      checkInTime: visitResult.rows[0].check_in_time,
      distanceFromCustomer,
      geoFenceValid: geoFenceValid.valid,
      geoFenceWarning: geoFenceValid.reason
    };
  } catch (err) {
    console.error('[LOCATION] Error checking in:', err.message);
    throw err;
  }
}

/**
 * Check out from a customer location
 * @param {string} visitId - Visit UUID
 * @param {object} location - {latitude, longitude, accuracy}
 * @param {string} notes - Visit notes
 * @param {string} outcome - Visit outcome
 */
async function checkOut(visitId, location, notes, outcome) {
  try {
    // Get visit details
    const visitQuery = `
      SELECT check_in_time
      FROM customer_visits
      WHERE id = $1
    `;
    const visitResult = await dbClient.query(visitQuery, [visitId]);

    if (visitResult.rows.length === 0) {
      throw new Error('Visit not found');
    }

    const checkInTime = new Date(visitResult.rows[0].check_in_time);
    const checkOutTime = new Date();
    const durationMinutes = Math.round((checkOutTime - checkInTime) / (1000 * 60));

    // Update visit record
    const updateQuery = `
      UPDATE customer_visits
      SET 
        check_out_time = $1,
        check_out_latitude = $2,
        check_out_longitude = $3,
        check_out_accuracy = $4,
        duration_minutes = $5,
        notes = $6,
        outcome = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING id, check_out_time, duration_minutes
    `;

    const result = await dbClient.query(updateQuery, [
      checkOutTime,
      location.latitude,
      location.longitude,
      location.accuracy,
      durationMinutes,
      notes,
      outcome,
      visitId
    ]);

    // If this was a follow-up visit and successful, mark follow-up as completed
    if (outcome === 'successful') {
      await dbClient.query(
        `UPDATE conversations_new 
         SET follow_up_completed_at = NOW() 
         WHERE id = (SELECT conversation_id FROM customer_visits WHERE id = $1)
         AND follow_up_completed_at IS NULL`,
        [visitId]
      );
    }

    return {
      success: true,
      visitId: result.rows[0].id,
      checkOutTime: result.rows[0].check_out_time,
      durationMinutes: result.rows[0].duration_minutes
    };
  } catch (err) {
    console.error('[LOCATION] Error checking out:', err.message);
    throw err;
  }
}

/**
 * Validate geo-fence rules
 * @param {string} tenantId - Tenant UUID
 * @param {number} distanceFromCustomer - Distance in meters
 */
async function validateGeoFence(tenantId, distanceFromCustomer) {
  try {
    if (distanceFromCustomer === null) {
      return {
        valid: true,
        reason: 'Customer location not available, cannot validate'
      };
    }

    // Get geo-fence rules for tenant
    const rulesQuery = `
      SELECT max_distance_from_customer
      FROM geo_fence_rules
      WHERE tenant_id = $1 AND is_active = true AND rule_type = 'customer_proximity'
      LIMIT 1
    `;

    const result = await dbClient.query(rulesQuery, [tenantId]);

    if (result.rows.length === 0) {
      // No rules defined, allow check-in
      return { valid: true, reason: 'No geo-fence rules defined' };
    }

    const maxDistance = parseFloat(result.rows[0].max_distance_from_customer);

    if (distanceFromCustomer > maxDistance) {
      return {
        valid: false,
        reason: `Distance ${Math.round(distanceFromCustomer)}m exceeds maximum ${maxDistance}m`
      };
    }

    return { valid: true };
  } catch (err) {
    console.error('[LOCATION] Error validating geo-fence:', err.message);
    return { valid: true, reason: 'Validation error, allowing check-in' };
  }
}

/**
 * Get visit history for a salesman
 * @param {string} salesmanId - Salesman UUID
 * @param {number} days - Number of days to look back
 */
async function getVisitHistory(salesmanId, days = 30) {
  try {
    const query = `
      SELECT 
        v.id,
        v.visit_type,
        v.check_in_time,
        v.check_out_time,
        v.duration_minutes,
        v.distance_from_customer,
        v.notes,
        v.outcome,
        cp.name as customer_name,
        cp.phone as customer_phone,
        cp.city
      FROM customer_visits v
      LEFT JOIN customer_profiles_new cp ON cp.id = v.customer_id
      WHERE v.salesman_id = $1
        AND v.check_in_time >= NOW() - INTERVAL '${days} days'
      ORDER BY v.check_in_time DESC
      LIMIT 100
    `;

    const result = await dbClient.query(query, [salesmanId]);

    return {
      success: true,
      visits: result.rows,
      count: result.rows.length
    };
  } catch (err) {
    console.error('[LOCATION] Error getting visit history:', err.message);
    throw err;
  }
}

/**
 * Optimize route for a list of customers using nearest neighbor algorithm
 * @param {string} salesmanId - Salesman UUID
 * @param {string} tenantId - Tenant UUID
 * @param {Array} customerIds - Array of customer UUIDs to visit
 * @param {object} startLocation - {latitude, longitude} - Starting point
 */
async function optimizeRoute(salesmanId, tenantId, customerIds, startLocation) {
  try {
    // Get customer locations
    const customersQuery = `
      SELECT id, name, latitude, longitude, city
      FROM customer_profiles_new
      WHERE id = ANY($1) AND tenant_id = $2
    `;

    const customersResult = await dbClient.query(customersQuery, [customerIds, tenantId]);
    const customers = customersResult.rows;

    // Filter customers with valid locations
    const validCustomers = customers.filter(c => c.latitude && c.longitude);

    if (validCustomers.length === 0) {
      throw new Error('No customers with valid locations');
    }

    // Nearest neighbor algorithm
    const optimizedOrder = [];
    const remaining = [...validCustomers];
    let currentLocation = startLocation;
    let totalDistance = 0;

    while (remaining.length > 0) {
      // Find nearest customer
      let nearestIndex = 0;
      let nearestDistance = calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        remaining[0].latitude,
        remaining[0].longitude
      );

      for (let i = 1; i < remaining.length; i++) {
        const distance = calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          remaining[i].latitude,
          remaining[i].longitude
        );

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }

      // Add nearest customer to route
      const nearestCustomer = remaining[nearestIndex];
      optimizedOrder.push({
        customerId: nearestCustomer.id,
        customerName: nearestCustomer.name,
        city: nearestCustomer.city,
        latitude: nearestCustomer.latitude,
        longitude: nearestCustomer.longitude,
        distanceFromPrevious: nearestDistance
      });

      totalDistance += nearestDistance;
      currentLocation = {
        latitude: nearestCustomer.latitude,
        longitude: nearestCustomer.longitude
      };
      remaining.splice(nearestIndex, 1);
    }

    // Estimate duration (assuming 30 km/h avg speed + 30 min per visit)
    const travelTimeMinutes = Math.round((totalDistance / 1000) / 30 * 60);
    const visitTimeMinutes = validCustomers.length * 30;
    const estimatedDurationMinutes = travelTimeMinutes + visitTimeMinutes;

    return {
      success: true,
      optimizedOrder,
      totalCustomers: validCustomers.length,
      totalDistanceKm: Math.round(totalDistance / 1000 * 10) / 10,
      estimatedDurationMinutes,
      algorithm: 'nearest_neighbor'
    };
  } catch (err) {
    console.error('[LOCATION] Error optimizing route:', err.message);
    throw err;
  }
}

/**
 * Save optimized route for a day
 * @param {string} salesmanId - Salesman UUID
 * @param {string} tenantId - Tenant UUID
 * @param {Date} routeDate - Route date
 * @param {object} routeData - Route optimization data
 */
async function saveRoute(salesmanId, tenantId, routeDate, routeData) {
  try {
    const query = `
      INSERT INTO daily_routes (
        salesman_id, tenant_id, route_date,
        total_customers, total_distance_km, estimated_duration_minutes,
        optimized_order, optimization_algorithm, optimized_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (salesman_id, route_date)
      DO UPDATE SET
        total_customers = EXCLUDED.total_customers,
        total_distance_km = EXCLUDED.total_distance_km,
        estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
        optimized_order = EXCLUDED.optimized_order,
        optimization_algorithm = EXCLUDED.optimization_algorithm,
        optimized_at = NOW(),
        updated_at = NOW()
      RETURNING id
    `;

    const result = await dbClient.query(query, [
      salesmanId,
      tenantId,
      routeDate,
      routeData.totalCustomers,
      routeData.totalDistanceKm,
      routeData.estimatedDurationMinutes,
      JSON.stringify(routeData.optimizedOrder),
      routeData.algorithm
    ]);

    return {
      success: true,
      routeId: result.rows[0].id
    };
  } catch (err) {
    console.error('[LOCATION] Error saving route:', err.message);
    throw err;
  }
}

/**
 * Get today's route for a salesman
 * @param {string} salesmanId - Salesman UUID
 * @param {Date} date - Route date (defaults to today)
 */
async function getRoute(salesmanId, date = new Date()) {
  try {
    const query = `
      SELECT 
        id,
        route_date,
        total_customers,
        total_distance_km,
        estimated_duration_minutes,
        optimized_order,
        optimization_algorithm,
        status,
        started_at,
        completed_at,
        optimized_at
      FROM daily_routes
      WHERE salesman_id = $1 AND route_date = $2
    `;

    const result = await dbClient.query(query, [salesmanId, date.toISOString().split('T')[0]]);

    if (result.rows.length === 0) {
      return { success: false, route: null };
    }

    return {
      success: true,
      route: result.rows[0]
    };
  } catch (err) {
    console.error('[LOCATION] Error getting route:', err.message);
    throw err;
  }
}

module.exports = {
  calculateDistance,
  recordLocation,
  checkIn,
  checkOut,
  validateGeoFence,
  getVisitHistory,
  optimizeRoute,
  saveRoute,
  getRoute
};
