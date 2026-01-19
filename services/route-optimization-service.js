/**
 * Route Optimization Service
 * 
 * Provides intelligent route planning for field sales using:
 * - Traveling Salesman Problem (TSP) algorithms
 * - GPS-based clustering
 * - Time window constraints
 * - Traffic pattern integration
 * - Multi-objective optimization (distance, time, visits)
 */

const Database = require('better-sqlite3');
const path = require('path');

class RouteOptimizationService {
  /**
   * Calculate distance between two GPS coordinates (Haversine formula)
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in kilometers
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this._toRad(lat2 - lat1);
    const dLon = this._toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this._toRad(lat1)) * Math.cos(this._toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static _toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Optimize route using Nearest Neighbor + 2-Opt algorithm
   * @param {string} tenantId - Tenant ID
   * @param {string} salesmanId - Salesman ID
   * @param {Array} visitIds - Array of visit IDs to optimize
   * @param {Object} options - Optimization options
   * @returns {Object} Optimized route with metrics
   */
  static async optimizeRoute(tenantId, salesmanId, visitIds, options = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');
    const startTime = Date.now();

    try {
      // Get salesman preferences
      const preferences = db.prepare(`
        SELECT * FROM route_preferences 
        WHERE tenant_id = ? AND salesman_id = ?
      `).get(tenantId, salesmanId) || this._getDefaultPreferences();

      // Get visit details with GPS coordinates
      const visits = db.prepare(`
        SELECT id, customer_id, customer_name, gps_latitude, gps_longitude,
               visit_date, potential, time_in
        FROM visits
        WHERE id IN (${visitIds.map(() => '?').join(',')})
          AND tenant_id = ?
      `).all(...visitIds, tenantId);

      if (visits.length === 0) {
        throw new Error('No valid visits found');
      }

      // Get customer time windows
      const timeWindows = this._getTimeWindows(db, tenantId, visits.map(v => v.customer_id));

      // Determine start location
      const startLat = options.startLatitude || preferences.default_start_latitude;
      const startLon = options.startLongitude || preferences.default_start_longitude;

      if (!startLat || !startLon) {
        throw new Error('Start location is required');
      }

      // Build distance matrix
      const locations = [
        { id: 'START', latitude: startLat, longitude: startLon, isStart: true },
        ...visits.map(v => ({
          id: v.id,
          latitude: v.gps_latitude,
          longitude: v.gps_longitude,
          customer_id: v.customer_id,
          customer_name: v.customer_name,
          potential: v.potential,
          timeWindow: timeWindows[v.customer_id]
        }))
      ];

      const distanceMatrix = this._buildDistanceMatrix(locations);

      // Apply Nearest Neighbor algorithm
      let route = this._nearestNeighborTSP(locations, distanceMatrix, preferences);

      // Improve with 2-Opt
      route = this._twoOptImprovement(route, distanceMatrix, preferences);

      // Apply time window constraints
      route = this._applyTimeWindowConstraints(route, timeWindows, preferences);

      // Calculate route metrics
      const metrics = this._calculateRouteMetrics(route, distanceMatrix, preferences);

      // Save optimized route
      const routeId = this._saveOptimizedRoute(db, {
        tenantId,
        salesmanId,
        route,
        metrics,
        preferences,
        startLat,
        startLon,
        optimizationTimeMs: Date.now() - startTime,
        routeDate: options.routeDate || new Date().toISOString().split('T')[0]
      });

      return {
        routeId,
        visitSequence: route.map(loc => loc.id).filter(id => id !== 'START' && id !== 'END'),
        totalVisits: route.filter(loc => !loc.isStart && !loc.isEnd).length,
        totalDistanceKm: metrics.totalDistance,
        estimatedTravelTimeMinutes: metrics.estimatedTravelTime,
        estimatedFuelCost: metrics.estimatedFuelCost,
        optimizationTimeMs: Date.now() - startTime,
        routeDetails: route.map((loc, index) => ({
          sequenceNumber: index + 1,
          visitId: loc.id,
          customerName: loc.customer_name,
          distanceFromPrevious: index > 0 ? distanceMatrix[route[index - 1].id][loc.id] : 0,
          cumulativeDistance: metrics.segmentDistances[index],
          estimatedArrivalTime: metrics.arrivalTimes[index],
          timeWindow: loc.timeWindow
        }))
      };

    } finally {
      db.close();
    }
  }

  /**
   * Nearest Neighbor TSP algorithm (greedy approach)
   */
  static _nearestNeighborTSP(locations, distanceMatrix, preferences) {
    const unvisited = locations.slice(1); // Exclude START
    const route = [locations[0]]; // Start from START location
    let current = locations[0];

    while (unvisited.length > 0) {
      // Find nearest unvisited location
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const distance = distanceMatrix[current.id][unvisited[i].id];
        
        // Apply potential weighting (higher potential = slight preference)
        const weightedDistance = distance * (1 - (this._getPotentialScore(unvisited[i].potential) * 0.1));
        
        if (weightedDistance < nearestDistance) {
          nearestDistance = weightedDistance;
          nearestIndex = i;
        }
      }

      const next = unvisited.splice(nearestIndex, 1)[0];
      route.push(next);
      current = next;
    }

    // Return to start if required
    if (preferences.return_to_start) {
      route.push({ ...locations[0], id: 'END', isEnd: true });
    }

    return route;
  }

  /**
   * 2-Opt improvement algorithm
   * Repeatedly tries reversing segments to find better route
   */
  static _twoOptImprovement(route, distanceMatrix, preferences, maxIterations = 100) {
    let improved = true;
    let iterations = 0;
    let bestRoute = [...route];
    let bestDistance = this._calculateTotalDistance(bestRoute, distanceMatrix);

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (let i = 1; i < route.length - 2; i++) {
        for (let j = i + 1; j < route.length - 1; j++) {
          // Try reversing segment [i...j]
          const newRoute = [
            ...route.slice(0, i),
            ...route.slice(i, j + 1).reverse(),
            ...route.slice(j + 1)
          ];

          const newDistance = this._calculateTotalDistance(newRoute, distanceMatrix);

          if (newDistance < bestDistance) {
            bestRoute = newRoute;
            bestDistance = newDistance;
            improved = true;
          }
        }
      }

      route = bestRoute;
    }

    return bestRoute;
  }

  /**
   * Calculate total route distance
   */
  static _calculateTotalDistance(route, distanceMatrix) {
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      total += distanceMatrix[route[i].id][route[i + 1].id];
    }
    return total;
  }

  /**
   * Build distance matrix for all location pairs
   */
  static _buildDistanceMatrix(locations) {
    const matrix = {};
    
    for (const loc1 of locations) {
      matrix[loc1.id] = {};
      for (const loc2 of locations) {
        if (loc1.id === loc2.id) {
          matrix[loc1.id][loc2.id] = 0;
        } else {
          matrix[loc1.id][loc2.id] = this.calculateDistance(
            loc1.latitude,
            loc1.longitude,
            loc2.latitude,
            loc2.longitude
          );
        }
      }
    }

    return matrix;
  }

  /**
   * Apply time window constraints to route
   */
  static _applyTimeWindowConstraints(route, timeWindows, preferences) {
    // Sort visits with strict time windows first
    const strictWindows = route.filter(loc => 
      loc.timeWindow && loc.timeWindow.is_strict === 1
    );

    const flexibleVisits = route.filter(loc => 
      !loc.timeWindow || loc.timeWindow.is_strict === 0
    );

    // For strict windows, prioritize by window start time
    strictWindows.sort((a, b) => {
      const timeA = a.timeWindow?.window_start_time || '00:00';
      const timeB = b.timeWindow?.window_start_time || '00:00';
      return timeA.localeCompare(timeB);
    });

    // Rebuild route: START -> strict windows -> flexible -> END
    const start = route.find(loc => loc.isStart);
    const end = route.find(loc => loc.isEnd);
    
    const newRoute = [start, ...strictWindows, ...flexibleVisits];
    if (end) newRoute.push(end);

    return newRoute.filter(Boolean);
  }

  /**
   * Calculate comprehensive route metrics
   */
  static _calculateRouteMetrics(route, distanceMatrix, preferences) {
    const metrics = {
      totalDistance: 0,
      estimatedTravelTime: 0,
      estimatedFuelCost: 0,
      segmentDistances: [],
      arrivalTimes: [],
      visitDurations: []
    };

    let currentTime = this._parseTime(preferences.work_start_time);
    let cumulativeDistance = 0;

    for (let i = 0; i < route.length; i++) {
      const location = route[i];
      
      if (i > 0) {
        // Calculate distance from previous location
        const distance = distanceMatrix[route[i - 1].id][location.id];
        cumulativeDistance += distance;
        
        // Estimate travel time (assuming 40 km/h average with traffic)
        const travelTimeMinutes = (distance / 40) * 60 * preferences.travel_buffer_percentage;
        currentTime += travelTimeMinutes;
        
        metrics.totalDistance += distance;
        metrics.estimatedTravelTime += travelTimeMinutes;
      }

      metrics.segmentDistances.push(cumulativeDistance);
      metrics.arrivalTimes.push(this._formatTime(currentTime));

      // Add visit duration (if not start/end point)
      if (!location.isStart && !location.isEnd) {
        currentTime += preferences.average_visit_duration_minutes;
        metrics.visitDurations.push(preferences.average_visit_duration_minutes);
      }

      // Check for lunch break
      if (currentTime >= this._parseTime(preferences.lunch_break_start) &&
          currentTime < this._parseTime(preferences.lunch_break_start) + preferences.lunch_break_duration_minutes) {
        currentTime = this._parseTime(preferences.lunch_break_start) + preferences.lunch_break_duration_minutes;
      }
    }

    metrics.estimatedFuelCost = metrics.totalDistance * preferences.fuel_cost_per_km;
    metrics.estimatedEndTime = this._formatTime(currentTime);

    return metrics;
  }

  /**
   * Get customer time windows
   */
  static _getTimeWindows(db, tenantId, customerIds) {
    const windows = {};
    
    if (customerIds.length === 0) return windows;

    const results = db.prepare(`
      SELECT customer_id, day_of_week, window_start_time, window_end_time,
             is_strict, priority_level
      FROM customer_time_windows
      WHERE tenant_id = ?
        AND customer_id IN (${customerIds.map(() => '?').join(',')})
        AND is_active = 1
      ORDER BY priority_level DESC
    `).all(tenantId, ...customerIds);

    for (const row of results) {
      if (!windows[row.customer_id]) {
        windows[row.customer_id] = row;
      }
    }

    return windows;
  }

  /**
   * Save optimized route to database
   */
  static _saveOptimizedRoute(db, data) {
    const result = db.prepare(`
      INSERT INTO optimized_routes (
        tenant_id, salesman_id, route_name, route_date,
        algorithm_used, optimization_time_ms,
        visit_sequence, total_visits,
        total_distance_km, estimated_travel_time_minutes, estimated_fuel_cost,
        start_latitude, start_longitude,
        route_start_time, route_end_time,
        route_status, constraints_applied
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.tenantId,
      data.salesmanId,
      `Route ${data.routeDate}`,
      data.routeDate,
      'nearest_neighbor_2opt',
      data.optimizationTimeMs,
      JSON.stringify(data.route.map(loc => loc.id)),
      data.route.filter(loc => !loc.isStart && !loc.isEnd).length,
      data.metrics.totalDistance,
      data.metrics.estimatedTravelTime,
      data.metrics.estimatedFuelCost,
      data.startLat,
      data.startLon,
      data.preferences.work_start_time,
      data.metrics.estimatedEndTime,
      'planned',
      JSON.stringify({
        max_visits: data.preferences.max_visits_per_day,
        max_distance: data.preferences.max_distance_per_day_km
      })
    );

    return result.lastInsertRowid;
  }

  /**
   * Create GPS-based clusters of visits
   */
  static async createVisitClusters(tenantId, options = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const numClusters = options.numClusters || 5;
      
      // Get all visits with GPS coordinates
      const visits = db.prepare(`
        SELECT id, customer_id, customer_name, gps_latitude, gps_longitude, potential
        FROM visits
        WHERE tenant_id = ?
          AND gps_latitude IS NOT NULL
          AND gps_longitude IS NOT NULL
          AND gps_latitude != 0
          AND gps_longitude != 0
        ORDER BY visit_date DESC
        LIMIT 1000
      `).all(tenantId);

      if (visits.length < numClusters) {
        throw new Error(`Not enough visits (${visits.length}) for ${numClusters} clusters`);
      }

      // K-means clustering
      const clusters = this._kMeansClustering(visits, numClusters);

      // Save clusters to database
      const clusterIds = [];
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        
        const result = db.prepare(`
          INSERT INTO visit_clusters (
            tenant_id, cluster_name,
            center_latitude, center_longitude,
            min_latitude, max_latitude,
            min_longitude, max_longitude,
            radius_km, visit_count, total_potential,
            clustering_method
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tenantId,
          `Cluster ${i + 1}`,
          cluster.centroid.latitude,
          cluster.centroid.longitude,
          cluster.bounds.minLat,
          cluster.bounds.maxLat,
          cluster.bounds.minLon,
          cluster.bounds.maxLon,
          cluster.radius,
          cluster.visits.length,
          cluster.totalPotential,
          'kmeans'
        );

        const clusterId = result.lastInsertRowid;
        clusterIds.push(clusterId);

        // Assign visits to cluster
        for (const visit of cluster.visits) {
          const distance = this.calculateDistance(
            cluster.centroid.latitude,
            cluster.centroid.longitude,
            visit.gps_latitude,
            visit.gps_longitude
          );

          db.prepare(`
            INSERT OR REPLACE INTO visit_cluster_assignments (
              visit_id, cluster_id, tenant_id,
              distance_from_center_km, assignment_confidence
            ) VALUES (?, ?, ?, ?, ?)
          `).run(visit.id, clusterId, tenantId, distance, 1.0);
        }
      }

      return {
        totalClusters: clusters.length,
        totalVisitsProcessed: visits.length,
        clusterIds,
        clusters: clusters.map((c, i) => ({
          clusterId: clusterIds[i],
          centerLat: c.centroid.latitude,
          centerLon: c.centroid.longitude,
          visitCount: c.visits.length,
          radiusKm: c.radius,
          totalPotential: c.totalPotential
        }))
      };

    } finally {
      db.close();
    }
  }

  /**
   * K-Means clustering algorithm
   */
  static _kMeansClustering(visits, k, maxIterations = 100) {
    // Initialize centroids randomly
    let centroids = [];
    const indices = new Set();
    while (centroids.length < k) {
      const idx = Math.floor(Math.random() * visits.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        centroids.push({
          latitude: visits[idx].gps_latitude,
          longitude: visits[idx].gps_longitude
        });
      }
    }

    let clusters = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      // Assign visits to nearest centroid
      clusters = Array(k).fill(null).map(() => ({ visits: [] }));

      for (const visit of visits) {
        let nearestCentroid = 0;
        let minDistance = Infinity;

        for (let i = 0; i < centroids.length; i++) {
          const distance = this.calculateDistance(
            visit.gps_latitude,
            visit.gps_longitude,
            centroids[i].latitude,
            centroids[i].longitude
          );

          if (distance < minDistance) {
            minDistance = distance;
            nearestCentroid = i;
          }
        }

        clusters[nearestCentroid].visits.push(visit);
      }

      // Recalculate centroids
      let changed = false;
      for (let i = 0; i < k; i++) {
        if (clusters[i].visits.length === 0) continue;

        const newCentroid = {
          latitude: clusters[i].visits.reduce((sum, v) => sum + v.gps_latitude, 0) / clusters[i].visits.length,
          longitude: clusters[i].visits.reduce((sum, v) => sum + v.gps_longitude, 0) / clusters[i].visits.length
        };

        if (Math.abs(newCentroid.latitude - centroids[i].latitude) > 0.0001 ||
            Math.abs(newCentroid.longitude - centroids[i].longitude) > 0.0001) {
          centroids[i] = newCentroid;
          changed = true;
        }
      }

      if (!changed) break;
      iterations++;
    }

    // Calculate cluster metadata
    return clusters.map(cluster => {
      const lats = cluster.visits.map(v => v.gps_latitude);
      const lons = cluster.visits.map(v => v.gps_longitude);
      
      const bounds = {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      };

      // Calculate radius (max distance from centroid)
      const centroid = {
        latitude: lats.reduce((a, b) => a + b, 0) / lats.length,
        longitude: lons.reduce((a, b) => a + b, 0) / lons.length
      };

      const radius = Math.max(...cluster.visits.map(v => 
        this.calculateDistance(centroid.latitude, centroid.longitude, v.gps_latitude, v.gps_longitude)
      ));

      const totalPotential = cluster.visits.reduce((sum, v) => {
        return sum + this._getPotentialScore(v.potential);
      }, 0);

      return {
        centroid,
        bounds,
        radius,
        visits: cluster.visits,
        totalPotential
      };
    });
  }

  /**
   * Get route by ID with full details
   */
  static async getRouteDetails(tenantId, routeId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const route = db.prepare(`
        SELECT * FROM optimized_routes
        WHERE id = ? AND tenant_id = ?
      `).get(routeId, tenantId);

      if (!route) {
        throw new Error('Route not found');
      }

      const visitIds = JSON.parse(route.visit_sequence).filter(id => id !== 'START' && id !== 'END');
      
      const visits = db.prepare(`
        SELECT id, customer_name, gps_latitude, gps_longitude, potential
        FROM visits
        WHERE id IN (${visitIds.map(() => '?').join(',')})
      `).all(...visitIds);

      return {
        ...route,
        visit_sequence: JSON.parse(route.visit_sequence),
        constraints_applied: JSON.parse(route.constraints_applied),
        visits
      };

    } finally {
      db.close();
    }
  }

  /**
   * Update route status
   */
  static async updateRouteStatus(tenantId, routeId, status, actualMetrics = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      db.prepare(`
        UPDATE optimized_routes
        SET route_status = ?,
            actual_distance_km = ?,
            actual_time_minutes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?
      `).run(
        status,
        actualMetrics.distanceKm || null,
        actualMetrics.timeMinutes || null,
        routeId,
        tenantId
      );

      // Log to history
      if (actualMetrics.distanceKm) {
        const route = db.prepare('SELECT * FROM optimized_routes WHERE id = ?').get(routeId);
        
        const efficiencyScore = Math.min(100, (route.total_distance_km / actualMetrics.distanceKm) * 100);
        const timeSaved = route.estimated_travel_time_minutes - (actualMetrics.timeMinutes || 0);

        db.prepare(`
          INSERT INTO route_optimization_history (
            tenant_id, salesman_id, route_id, event_type,
            planned_distance_km, actual_distance_km,
            planned_time_minutes, actual_time_minutes,
            efficiency_score, time_saved_minutes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tenantId,
          route.salesman_id,
          routeId,
          'route_completed',
          route.total_distance_km,
          actualMetrics.distanceKm,
          route.estimated_travel_time_minutes,
          actualMetrics.timeMinutes,
          efficiencyScore,
          timeSaved
        );
      }

      return { success: true };

    } finally {
      db.close();
    }
  }

  // Helper methods
  static _getDefaultPreferences() {
    return {
      minimize_distance_weight: 0.4,
      minimize_time_weight: 0.4,
      maximize_visits_weight: 0.2,
      max_visits_per_day: 10,
      max_distance_per_day_km: 150,
      max_hours_per_day: 8,
      work_start_time: '09:00',
      work_end_time: '18:00',
      lunch_break_start: '13:00',
      lunch_break_duration_minutes: 60,
      average_visit_duration_minutes: 45,
      travel_buffer_percentage: 1.2,
      return_to_start: 1,
      fuel_cost_per_km: 0.15
    };
  }

  static _getPotentialScore(potential) {
    const scores = { 'High': 100, 'Medium': 50, 'Low': 25 };
    return scores[potential] || 50;
  }

  static _parseTime(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  static _formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }
}

module.exports = RouteOptimizationService;
