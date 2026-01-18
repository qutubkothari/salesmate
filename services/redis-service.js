/**
 * Redis Service
 * Centralized Redis caching for multi-instance deployments
 * Replaces in-memory cache with distributed Redis cache
 */

const redis = require('redis');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.stats = { hits: 0, misses: 0, errors: 0 };
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    try {
      // Redis configuration from environment or defaults
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0'),
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      };

      this.client = redis.createClient(redisConfig);

      // Event handlers
      this.client.on('connect', () => {
        console.log('[REDIS] Connected to Redis server');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('[REDIS] Redis error:', err.message);
        this.stats.errors++;
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        console.log('[REDIS] Reconnecting to Redis...');
      });

      await this.client.connect();
      
      return true;
    } catch (error) {
      console.error('[REDIS] Failed to connect:', error.message);
      console.log('[REDIS] Falling back to in-memory cache');
      return false;
    }
  }

  /**
   * Get value from cache
   */
  async get(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      
      if (value) {
        this.stats.hits++;
        return JSON.parse(value);
      } else {
        this.stats.misses++;
        return null;
      }
    } catch (error) {
      console.error('[REDIS] Get error:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key, value, ttlSeconds = 3600) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, ttlSeconds, serialized);
      return true;
    } catch (error) {
      console.error('[REDIS] Set error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Delete key(s) from cache
   */
  async delete(pattern) {
    if (!this.isConnected || !this.client) {
      return 0;
    }

    try {
      if (pattern.includes('*')) {
        // Pattern matching - scan and delete
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          return await this.client.del(keys);
        }
        return 0;
      } else {
        // Single key delete
        return await this.client.del(pattern);
      }
    } catch (error) {
      console.error('[REDIS] Delete error:', error.message);
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('[REDIS] Exists error:', error.message);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    const stats = {
      connected: this.isConnected,
      hits: this.stats.hits,
      misses: this.stats.misses,
      errors: this.stats.errors,
      hitRate: this.stats.hits + this.stats.misses > 0 
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
        : '0%'
    };

    if (this.isConnected && this.client) {
      try {
        const info = await this.client.info('stats');
        const lines = info.split('\r\n');
        const serverStats = {};
        
        lines.forEach(line => {
          const [key, value] = line.split(':');
          if (key && value) {
            serverStats[key] = value;
          }
        });

        stats.server = {
          totalConnections: serverStats.total_connections_received,
          totalCommands: serverStats.total_commands_processed,
          keyspaceHits: serverStats.keyspace_hits,
          keyspaceMisses: serverStats.keyspace_misses,
          usedMemory: serverStats.used_memory_human
        };
      } catch (error) {
        console.error('[REDIS] Stats error:', error.message);
      }
    }

    return stats;
  }

  /**
   * Flush all cache
   */
  async flush() {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.flushDb();
      console.log('[REDIS] Cache flushed');
      return true;
    } catch (error) {
      console.error('[REDIS] Flush error:', error.message);
      return false;
    }
  }

  /**
   * Increment counter
   */
  async increment(key, amount = 1) {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      return await this.client.incrBy(key, amount);
    } catch (error) {
      console.error('[REDIS] Increment error:', error.message);
      return null;
    }
  }

  /**
   * Set expiration on key
   */
  async expire(key, ttlSeconds) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      return await this.client.expire(key, ttlSeconds);
    } catch (error) {
      console.error('[REDIS] Expire error:', error.message);
      return false;
    }
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern = '*') {
    if (!this.isConnected || !this.client) {
      return [];
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      console.error('[REDIS] Keys error:', error.message);
      return [];
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
        console.log('[REDIS] Disconnected from Redis');
        this.isConnected = false;
      } catch (error) {
        console.error('[REDIS] Disconnect error:', error.message);
      }
    }
  }

  /**
   * Health check
   */
  async ping() {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      console.error('[REDIS] Ping error:', error.message);
      return false;
    }
  }
}

// Singleton instance
const redisService = new RedisService();

module.exports = redisService;
