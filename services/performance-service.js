/**
 * Performance & Scale Service
 * Caching, query optimization, rate limiting, health monitoring, system metrics
 */

const crypto = require('crypto');
const { db } = require('./config');
const redisService = require('./redis-service');

let useRedis = false;

class PerformanceService {
  
  // In-memory cache (for speed)
  static memoryCache = new Map();
  static cacheStats = { hits: 0, misses: 0 };
  
  /**
   * Initialize Redis cache (call on server startup)
   */
  static async initializeCache() {
    try {
      await redisService.connect();
      useRedis = true;
      console.log('✅ Redis cache initialized');
    } catch (error) {
      console.warn('⚠️ Redis not available, using memory/DB cache:', error.message);
      useRedis = false;
    }
  }
  
  // ===== CACHING =====
  
  /**
   * Get from cache (checks Redis -> memory -> DB)
   */
  static async getCache(key) {
    // Check Redis first (if enabled)
    if (useRedis) {
      try {
        const redisValue = await redisService.get(key);
        if (redisValue !== null) {
          this.cacheStats.hits++;
          return redisValue;
        }
      } catch (error) {
        console.warn('Redis get error:', error.message);
      }
    }
    
    // Check memory cache
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key);
      if (new Date(entry.expires_at) > new Date()) {
        this.cacheStats.hits++;
        
        // Update hit count in DB (async, non-blocking)
        setImmediate(() => {
          db.prepare('UPDATE cache_entries SET hit_count = hit_count + 1, last_accessed_at = CURRENT_TIMESTAMP WHERE cache_key = ?').run(key);
        });
        
        return JSON.parse(entry.cache_value);
      } else {
        // Expired, remove from memory
        this.memoryCache.delete(key);
      }
    }
    
    // Check DB cache
    const entry = db.prepare(`
      SELECT * FROM cache_entries 
      WHERE cache_key = ? AND expires_at > datetime('now')
    `).get(key);
    
    if (entry) {
      this.cacheStats.hits++;
      
      // Load into memory cache
      this.memoryCache.set(key, entry);
      
      // Update hit count
      db.prepare('UPDATE cache_entries SET hit_count = hit_count + 1, last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?').run(entry.id);
      
      return JSON.parse(entry.cache_value);
    }
    
    this.cacheStats.misses++;
    return null;
  }
  
  /**
   * Set cache entry
   */
  static setCache(key, value, options = {}) {
    const {
      ttl = 3600,
      type = 'query_result',
      priority = 'normal',
      canEvict = true
    } = options;
    
    const id = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const serialized = JSON.stringify(value);
    const sizeBytes = Buffer.byteLength(serialized);
    
    // Check if cache key already exists
    const existing = db.prepare('SELECT id FROM cache_entries WHERE cache_key = ?').get(key);
    
    if (existing) {
      db.prepare(`
        UPDATE cache_entries 
        SET cache_value = ?, ttl_seconds = ?, expires_at = ?, 
            size_bytes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE cache_key = ?
      `).run(serialized, ttl, expiresAt, sizeBytes, key);
    } else {
      db.prepare(`
        INSERT INTO cache_entries (
          id, cache_key, cache_value, cache_type, ttl_seconds, 
          expires_at, size_bytes, cache_priority, can_evict
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, key, serialized, type, ttl, expiresAt, sizeBytes, priority, canEvict ? 1 : 0);
    }
    
    // Store in Redis (if enabled)
    if (useRedis) {
      try {
        await redisService.set(key, value, ttl);
      } catch (error) {
        console.warn('Redis set error:', error.message);
      }
    }
    
    // Store in memory cache
    this.memoryCache.set(key, {
      cache_value: serialized,
      expires_at: expiresAt
    });
    
    // Evict old entries if memory cache is too large (keep max 1000 entries)
    if (this.memoryCache.size > 1000) {
      this.evictOldestMemoryCache();
    }
  }
  
  /**
   * Invalidate cache by key or pattern
   */
  static async invalidateCache(keyOrPattern) {
    // Clear from Redis (if enabled)
    if (useRedis) {
      try {
        await redisService.delete(keyOrPattern);
      } catch (error) {
        console.warn('Redis delete error:', error.message);
      }
    }
    
    if (keyOrPattern.includes('*')) {
      // Pattern matching
      const pattern = keyOrPattern.replace(/\*/g, '%');
      db.prepare('DELETE FROM cache_entries WHERE cache_key LIKE ?').run(pattern);
      
      // Clear matching from memory
      for (const key of this.memoryCache.keys()) {
        if (key.match(keyOrPattern.replace(/\*/g, '.*'))) {
          this.memoryCache.delete(key);
        }
      }
    } else {
      // Exact key
      db.prepare('DELETE FROM cache_entries WHERE cache_key = ?').run(keyOrPattern);
      this.memoryCache.delete(keyOrPattern);
    }
  }
  
  /**
   * Evict expired and low-priority entries
   */
  static evictCache() {
    // Evict expired
    db.prepare("DELETE FROM cache_entries WHERE expires_at < datetime('now')").run();
    
    // Evict low-priority, low-hit entries if cache is too large
    const cacheSize = db.prepare('SELECT COUNT(*) as count FROM cache_entries').get().count;
    
    if (cacheSize > 10000) {
      db.prepare(`
        DELETE FROM cache_entries 
        WHERE can_evict = 1 
          AND cache_priority = 'low' 
          AND hit_count < 10
        ORDER BY last_accessed_at ASC 
        LIMIT 1000
      `).run();
    }
  }
  
  /**
   * Evict oldest from memory cache
   */
  static evictOldestMemoryCache() {
    const entries = Array.from(this.memoryCache.entries());
    entries.sort((a, b) => new Date(a[1].expires_at) - new Date(b[1].expires_at));
    
    // Remove oldest 20%
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      this.memoryCache.delete(entries[i][0]);
    }
  }
  
  /**
   * Get cache statistics
   */
  static async getCacheStats() {
    const dbStats = db.prepare(`
      SELECT 
        COUNT(*) as total_entries,
        SUM(size_bytes) as total_size_bytes,
        SUM(hit_count) as total_hits,
        AVG(hit_count) as avg_hits_per_entry,
        COUNT(CASE WHEN expires_at < datetime('now') THEN 1 END) as expired_entries
      FROM cache_entries
    `).get();
    
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(2)
      : 0;
    
    const stats = {
      memory: {
        entries: this.memoryCache.size,
        hits: this.cacheStats.hits,
        misses: this.cacheStats.misses,
        hitRate: `${hitRate}%`
      },
      database: dbStats
    };
    
    // Add Redis stats if enabled
    if (useRedis) {
      try {
        stats.redis = await redisService.getStats();
      } catch (error) {
        stats.redis = { error: error.message };
      }
    }
    
    return stats;
  }
  
  // ===== QUERY PERFORMANCE =====
  
  /**
   * Track query performance
   */
  static trackQuery(queryData) {
    const {
      tenantId = null,
      queryType,
      querySignature,
      tableName = null,
      executionTimeMs,
      rowsAffected = 0,
      rowsScanned = 0,
      usedIndex = false,
      endpoint = null,
      userId = null
    } = queryData;
    
    const id = crypto.randomBytes(16).toString('hex');
    const isSlowQuery = executionTimeMs > 1000 ? 1 : 0;
    const needsOptimization = (executionTimeMs > 500 || (rowsScanned > 1000 && !usedIndex)) ? 1 : 0;
    
    db.prepare(`
      INSERT INTO query_performance (
        id, tenant_id, query_type, query_signature, table_name,
        execution_time_ms, rows_affected, rows_scanned, used_index,
        is_slow_query, needs_optimization, endpoint, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, queryType, querySignature, tableName,
      executionTimeMs, rowsAffected, rowsScanned, usedIndex ? 1 : 0,
      isSlowQuery, needsOptimization, endpoint, userId
    );
    
    // Create alert for slow queries
    if (isSlowQuery) {
      this.createAlert({
        alertType: 'slow_query',
        severity: executionTimeMs > 5000 ? 'critical' : 'warning',
        metricName: 'execution_time_ms',
        metricValue: executionTimeMs,
        thresholdValue: 1000,
        alertTitle: 'Slow Query Detected',
        alertMessage: `Query on ${tableName || 'unknown'} took ${executionTimeMs}ms`
      });
    }
    
    return { id, isSlowQuery, needsOptimization };
  }
  
  /**
   * Get slow queries report
   */
  static getSlowQueries(limit = 50) {
    return db.prepare(`
      SELECT 
        query_signature,
        table_name,
        COUNT(*) as occurrence_count,
        AVG(execution_time_ms) as avg_time_ms,
        MAX(execution_time_ms) as max_time_ms,
        AVG(rows_scanned) as avg_rows_scanned,
        SUM(used_index) as times_used_index,
        MAX(executed_at) as last_occurrence
      FROM query_performance
      WHERE is_slow_query = 1
      GROUP BY query_signature
      ORDER BY avg_time_ms DESC
      LIMIT ?
    `).all(limit);
  }
  
  /**
   * Suggest query optimizations
   */
  static suggestOptimization(optimizationData) {
    const {
      querySignature,
      tableName,
      issueType,
      severity,
      suggestion,
      estimatedImprovement = null,
      implementationSql = null,
      affectedEndpoints = []
    } = optimizationData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO query_optimizations (
        id, query_signature, table_name, issue_type, severity,
        suggestion, estimated_improvement_percent, implementation_sql,
        affected_endpoints
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, querySignature, tableName, issueType, severity,
      suggestion, estimatedImprovement, implementationSql,
      JSON.stringify(affectedEndpoints)
    );
    
    return { id };
  }
  
  // ===== RATE LIMITING =====
  
  /**
   * Check rate limit
   */
  static checkRateLimit(limitType, limitKey, maxRequests = 100, windowSeconds = 60) {
    const now = new Date();
    
    const limit = db.prepare(`
      SELECT * FROM rate_limits 
      WHERE limit_type = ? AND limit_key = ?
    `).get(limitType, limitKey);
    
    if (!limit) {
      // Create new limit
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO rate_limits (
          id, limit_type, limit_key, max_requests, window_seconds, current_count
        ) VALUES (?, ?, ?, ?, ?, 1)
      `).run(id, limitType, limitKey, maxRequests, windowSeconds);
      
      return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
    }
    
    // Check if window has expired
    const windowStart = new Date(limit.window_start);
    const windowEnd = new Date(windowStart.getTime() + limit.window_seconds * 1000);
    
    if (now > windowEnd) {
      // Reset window
      db.prepare(`
        UPDATE rate_limits 
        SET current_count = 1, window_start = CURRENT_TIMESTAMP, is_blocked = 0, blocked_until = NULL
        WHERE id = ?
      `).run(limit.id);
      
      return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
    }
    
    // Check if blocked
    if (limit.is_blocked && limit.blocked_until && new Date(limit.blocked_until) > now) {
      return { allowed: false, remaining: 0, resetAt: new Date(limit.blocked_until), blocked: true };
    }
    
    // Increment counter
    const newCount = limit.current_count + 1;
    
    if (newCount > limit.max_requests) {
      // Block for remainder of window
      db.prepare(`
        UPDATE rate_limits 
        SET current_count = ?, is_blocked = 1, blocked_until = ?
        WHERE id = ?
      `).run(newCount, windowEnd.toISOString(), limit.id);
      
      return { allowed: false, remaining: 0, resetAt: windowEnd, blocked: true };
    }
    
    db.prepare('UPDATE rate_limits SET current_count = ? WHERE id = ?').run(newCount, limit.id);
    
    return { allowed: true, remaining: maxRequests - newCount, resetAt: windowEnd };
  }
  
  // ===== API METRICS =====
  
  /**
   * Track API request
   */
  static trackApiRequest(metricData) {
    const {
      tenantId = null,
      endpoint,
      httpMethod,
      responseTimeMs,
      statusCode,
      requestSizeBytes = 0,
      responseSizeBytes = 0,
      userId = null,
      ipAddress = null,
      userAgent = null,
      hasError = false,
      errorType = null,
      errorMessage = null
    } = metricData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO api_metrics (
        id, tenant_id, endpoint, http_method, response_time_ms, status_code,
        request_size_bytes, response_size_bytes, user_id, ip_address,
        user_agent, has_error, error_type, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, endpoint, httpMethod, responseTimeMs, statusCode,
      requestSizeBytes, responseSizeBytes, userId, ipAddress,
      userAgent, hasError ? 1 : 0, errorType, errorMessage
    );
    
    // Check for high latency
    if (responseTimeMs > 2000) {
      this.createAlert({
        alertType: 'high_latency',
        severity: responseTimeMs > 5000 ? 'critical' : 'warning',
        metricName: 'response_time_ms',
        metricValue: responseTimeMs,
        thresholdValue: 2000,
        alertTitle: 'High API Latency',
        alertMessage: `${httpMethod} ${endpoint} took ${responseTimeMs}ms`
      });
    }
    
    return { id };
  }
  
  /**
   * Get API performance metrics
   */
  static getApiMetrics(startDate, endDate, endpoint = null) {
    let query = `
      SELECT 
        endpoint,
        http_method,
        COUNT(*) as request_count,
        AVG(response_time_ms) as avg_response_time,
        MAX(response_time_ms) as max_response_time,
        MIN(response_time_ms) as min_response_time,
        SUM(CASE WHEN has_error = 1 THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) as server_error_count,
        AVG(response_size_bytes) as avg_response_size
      FROM api_metrics
      WHERE timestamp BETWEEN ? AND ?
    `;
    
    const params = [startDate, endDate];
    
    if (endpoint) {
      query += ' AND endpoint = ?';
      params.push(endpoint);
    }
    
    query += ' GROUP BY endpoint, http_method ORDER BY request_count DESC';
    
    return db.prepare(query).all(...params);
  }
  
  // ===== HEALTH CHECKS =====
  
  /**
   * Run health check
   */
  static runHealthCheck(checkData) {
    const {
      checkType,
      checkName,
      status,
      responseTimeMs = null,
      metricValue = null,
      metricUnit = null,
      warningThreshold = null,
      criticalThreshold = null,
      statusMessage = null,
      errorDetails = null
    } = checkData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO health_checks (
        id, check_type, check_name, status, response_time_ms,
        metric_value, metric_unit, warning_threshold, critical_threshold,
        status_message, error_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, checkType, checkName, status, responseTimeMs,
      metricValue, metricUnit, warningThreshold, criticalThreshold,
      statusMessage, errorDetails
    );
    
    // Create alert for unhealthy checks
    if (status === 'unhealthy' || status === 'degraded') {
      this.createAlert({
        alertType: 'resource_limit',
        severity: status === 'unhealthy' ? 'critical' : 'warning',
        metricName: checkName,
        metricValue,
        thresholdValue: status === 'unhealthy' ? criticalThreshold : warningThreshold,
        alertTitle: `Health Check ${status === 'unhealthy' ? 'Failed' : 'Degraded'}`,
        alertMessage: statusMessage || `${checkName} is ${status}`
      });
    }
    
    return { id };
  }
  
  /**
   * Get system health status
   */
  static getHealthStatus() {
    const recent = db.prepare(`
      SELECT check_type, check_name, status, metric_value, metric_unit, checked_at
      FROM health_checks
      WHERE checked_at > datetime('now', '-5 minutes')
      ORDER BY checked_at DESC
    `).all();
    
    const overall = recent.every(check => check.status === 'healthy') ? 'healthy' 
      : recent.some(check => check.status === 'unhealthy') ? 'unhealthy'
      : 'degraded';
    
    return {
      overall,
      checks: recent,
      timestamp: new Date().toISOString()
    };
  }
  
  // ===== PERFORMANCE ALERTS =====
  
  /**
   * Create performance alert
   */
  static createAlert(alertData) {
    const {
      alertType,
      severity,
      metricName = null,
      metricValue = null,
      thresholdValue = null,
      alertTitle,
      alertMessage
    } = alertData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO performance_alerts (
        id, alert_type, severity, metric_name, metric_value,
        threshold_value, alert_title, alert_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, alertType, severity, metricName, metricValue,
      thresholdValue, alertTitle, alertMessage
    );
    
    return { id };
  }
  
  /**
   * Get active alerts
   */
  static getActiveAlerts(severity = null) {
    let query = "SELECT * FROM performance_alerts WHERE status = 'active'";
    const params = [];
    
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    
    query += ' ORDER BY created_at DESC';
    
    return db.prepare(query).all(...params);
  }
  
  /**
   * Acknowledge alert
   */
  static acknowledgeAlert(alertId, acknowledgedBy) {
    db.prepare(`
      UPDATE performance_alerts 
      SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(acknowledgedBy, alertId);
  }
  
  /**
   * Resolve alert
   */
  static resolveAlert(alertId, resolutionNotes = null) {
    db.prepare(`
      UPDATE performance_alerts 
      SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolution_notes = ?
      WHERE id = ?
    `).run(resolutionNotes, alertId);
  }
}

module.exports = PerformanceService;
