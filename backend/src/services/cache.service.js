/**
 * Cache Service
 * 
 * Service untuk mengelola Redis cache operations
 * Menyediakan caching, rate limiting, dan session management
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

/**
 * CacheService Class
 * Mengelola semua operasi cache menggunakan Redis
 */
export class CacheService {
  constructor(storageService) {
    this.storage = storageService;
    
    // Cache configuration
    this.config = {
      defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 3600, // 1 hour
      shortTTL: parseInt(process.env.CACHE_SHORT_TTL) || 300,      // 5 minutes
      longTTL: parseInt(process.env.CACHE_LONG_TTL) || 86400,     // 24 hours
      keyPrefix: process.env.CACHE_KEY_PREFIX || 'mcp',
      enableCompression: process.env.CACHE_ENABLE_COMPRESSION === 'true',
      maxValueSize: parseInt(process.env.CACHE_MAX_VALUE_SIZE) || 1024 * 1024 // 1MB
    };

    // Rate limiting configuration
    this.rateLimits = {
      auth: { requests: 10, window: 300 },     // 10 requests per 5 minutes
      search: { requests: 100, window: 60 },   // 100 requests per minute
      notes: { requests: 200, window: 60 },    // 200 requests per minute
      api: { requests: 1000, window: 3600 }    // 1000 requests per hour
    };

    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      totalOperations: 0,
      startTime: Date.now()
    };
  }

  /**
   * Get Redis client
   */
  async getClient() {
    return await this.storage.cache();
  }

  /**
   * Generate cache key dengan prefix
   */
  generateKey(namespace, identifier, suffix = '') {
    const parts = [this.config.keyPrefix, namespace, identifier];
    if (suffix) parts.push(suffix);
    return parts.join(':');
  }

  /**
   * Set cache value dengan TTL
   */
  async set(key, value, ttl = null) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('cache', key);
      const cacheValue = this.serializeValue(value);
      
      // Check value size
      if (cacheValue.length > this.config.maxValueSize) {
        throw new Error(`Cache value too large: ${cacheValue.length} bytes`);
      }

      const actualTTL = ttl || this.config.defaultTTL;
      
      await client.setex(cacheKey, actualTTL, cacheValue);
      
      this.updateStats('sets');
      return true;
    } catch (error) {
      this.updateStats('errors');
      console.error(`❌ Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get cache value
   */
  async get(key) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('cache', key);
      
      const value = await client.get(cacheKey);
      
      if (value === null) {
        this.updateStats('misses');
        return null;
      }

      this.updateStats('hits');
      return this.deserializeValue(value);
    } catch (error) {
      this.updateStats('errors');
      console.error(`❌ Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete cache value
   */
  async delete(key) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('cache', key);
      
      const result = await client.del(cacheKey);
      
      this.updateStats('deletes');
      return result > 0;
    } catch (error) {
      this.updateStats('errors');
      console.error(`❌ Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if cache key exists
   */
  async exists(key) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('cache', key);
      
      const result = await client.exists(cacheKey);
      return result === 1;
    } catch (error) {
      console.error(`❌ Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get cache key TTL
   */
  async getTTL(key) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('cache', key);
      
      return await client.ttl(cacheKey);
    } catch (error) {
      console.error(`❌ Cache TTL error for key ${key}:`, error);
      return -1;
    }
  }

  /**
   * Extend cache TTL
   */
  async expire(key, ttl) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('cache', key);
      
      const result = await client.expire(cacheKey, ttl);
      return result === 1;
    } catch (error) {
      console.error(`❌ Cache expire error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get multiple cache values
   */
  async getMultiple(keys) {
    try {
      const client = await this.getClient();
      const cacheKeys = keys.map(key => this.generateKey('cache', key));
      
      const values = await client.mget(cacheKeys);
      const result = {};

      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== null) {
          result[key] = this.deserializeValue(value);
          this.updateStats('hits');
        } else {
          this.updateStats('misses');
        }
      });

      return result;
    } catch (error) {
      this.updateStats('errors');
      console.error('❌ Cache getMultiple error:', error);
      return {};
    }
  }

  /**
   * Set multiple cache values
   */
  async setMultiple(keyValuePairs, ttl = null) {
    try {
      const client = await this.getClient();
      const actualTTL = ttl || this.config.defaultTTL;
      
      const pipeline = client.pipeline();
      
      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const cacheKey = this.generateKey('cache', key);
        const cacheValue = this.serializeValue(value);
        pipeline.setex(cacheKey, actualTTL, cacheValue);
      });

      await pipeline.exec();
      
      this.updateStats('sets', Object.keys(keyValuePairs).length);
      return true;
    } catch (error) {
      this.updateStats('errors');
      console.error('❌ Cache setMultiple error:', error);
      return false;
    }
  }

  /**
   * Delete multiple cache values
   */
  async deleteMultiple(keys) {
    try {
      const client = await this.getClient();
      const cacheKeys = keys.map(key => this.generateKey('cache', key));
      
      const result = await client.del(cacheKeys);
      
      this.updateStats('deletes', result);
      return result;
    } catch (error) {
      this.updateStats('errors');
      console.error('❌ Cache deleteMultiple error:', error);
      return 0;
    }
  }

  /**
   * Clear cache berdasarkan pattern
   */
  async clearPattern(pattern) {
    try {
      const client = await this.getClient();
      const searchPattern = this.generateKey('cache', pattern);
      
      const keys = await client.keys(searchPattern);
      
      if (keys.length > 0) {
        const result = await client.del(keys);
        this.updateStats('deletes', result);
        return result;
      }
      
      return 0;
    } catch (error) {
      this.updateStats('errors');
      console.error(`❌ Cache clearPattern error for pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Increment counter value
   */
  async increment(key, amount = 1, ttl = null) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('counter', key);
      
      const result = await client.incrby(cacheKey, amount);
      
      // Set TTL jika ini adalah increment pertama
      if (result === amount && ttl) {
        await client.expire(cacheKey, ttl);
      }
      
      return result;
    } catch (error) {
      this.updateStats('errors');
      console.error(`❌ Cache increment error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Decrement counter value
   */
  async decrement(key, amount = 1) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('counter', key);
      
      const result = await client.decrby(cacheKey, amount);
      return result;
    } catch (error) {
      this.updateStats('errors');
      console.error(`❌ Cache decrement error for key ${key}:`, error);
      return null;
    }
  }

  // Session Management

  /**
   * Store session data
   */
  async setSession(sessionId, sessionData, ttl = null) {
    const sessionKey = this.generateKey('session', sessionId);
    const sessionTTL = ttl || this.config.longTTL; // 24 hours default
    
    return await this.set(sessionKey, sessionData, sessionTTL);
  }

  /**
   * Get session data
   */
  async getSession(sessionId) {
    const sessionKey = this.generateKey('session', sessionId);
    return await this.get(sessionKey);
  }

  /**
   * Update session data
   */
  async updateSession(sessionId, updates, ttl = null) {
    const sessionKey = this.generateKey('session', sessionId);
    const currentSession = await this.get(sessionKey) || {};
    
    const updatedSession = { ...currentSession, ...updates };
    const sessionTTL = ttl || this.config.longTTL;
    
    return await this.set(sessionKey, updatedSession, sessionTTL);
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    const sessionKey = this.generateKey('session', sessionId);
    return await this.delete(sessionKey);
  }

  /**
   * Extend session TTL
   */
  async extendSession(sessionId, ttl = null) {
    const sessionKey = this.generateKey('session', sessionId);
    const sessionTTL = ttl || this.config.longTTL;
    
    return await this.expire(sessionKey, sessionTTL);
  }

  // Rate Limiting

  /**
   * Check rate limit untuk user/IP
   */
  async checkRateLimit(identifier, type = 'api') {
    try {
      const limitConfig = this.rateLimits[type] || this.rateLimits.api;
      const windowStart = Math.floor(Date.now() / 1000 / limitConfig.window) * limitConfig.window;
      const rateLimitKey = this.generateKey('ratelimit', `${type}:${identifier}:${windowStart}`);
      
      const current = await this.increment(rateLimitKey, 1, limitConfig.window);
      
      const remaining = Math.max(0, limitConfig.requests - current);
      const resetTime = (windowStart + limitConfig.window) * 1000;
      
      return {
        allowed: current <= limitConfig.requests,
        current,
        limit: limitConfig.requests,
        remaining,
        resetTime: new Date(resetTime).toISOString(),
        retryAfter: current > limitConfig.requests ? Math.ceil((resetTime - Date.now()) / 1000) : 0
      };
    } catch (error) {
      console.error('❌ Rate limit check error:', error);
      // Fail open - allow request if cache is down
      return {
        allowed: true,
        current: 0,
        limit: 1000,
        remaining: 1000,
        resetTime: new Date(Date.now() + 3600000).toISOString(),
        retryAfter: 0
      };
    }
  }

  /**
   * Reset rate limit untuk user/IP
   */
  async resetRateLimit(identifier, type = 'api') {
    try {
      const pattern = this.generateKey('ratelimit', `${type}:${identifier}:*`);
      return await this.clearPattern(pattern);
    } catch (error) {
      console.error('❌ Rate limit reset error:', error);
      return 0;
    }
  }

  // Cache Tags

  /**
   * Set cache dengan tags untuk group invalidation
   */
  async setWithTags(key, value, tags = [], ttl = null) {
    try {
      // Set main cache value
      const setResult = await this.set(key, value, ttl);
      
      if (setResult && tags.length > 0) {
        const client = await this.getClient();
        const pipeline = client.pipeline();
        
        // Add key ke setiap tag set
        tags.forEach(tag => {
          const tagKey = this.generateKey('tag', tag);
          pipeline.sadd(tagKey, this.generateKey('cache', key));
          
          // Set TTL untuk tag key jika belum ada
          const tagTTL = ttl || this.config.longTTL;
          pipeline.expire(tagKey, tagTTL);
        });
        
        await pipeline.exec();
      }
      
      return setResult;
    } catch (error) {
      this.updateStats('errors');
      console.error('❌ Cache setWithTags error:', error);
      return false;
    }
  }

  /**
   * Invalidate cache berdasarkan tags
   */
  async invalidateByTags(tags) {
    try {
      if (!Array.isArray(tags) || tags.length === 0) {
        return 0;
      }

      const client = await this.getClient();
      let totalDeleted = 0;

      for (const tag of tags) {
        const tagKey = this.generateKey('tag', tag);
        
        // Get semua keys dengan tag ini
        const keys = await client.smembers(tagKey);
        
        if (keys.length > 0) {
          // Delete semua keys
          const deleted = await client.del(keys);
          totalDeleted += deleted;
          
          // Delete tag set
          await client.del(tagKey);
        }
      }

      this.updateStats('deletes', totalDeleted);
      return totalDeleted;
    } catch (error) {
      this.updateStats('errors');
      console.error('❌ Cache invalidateByTags error:', error);
      return 0;
    }
  }

  // Lock Management

  /**
   * Acquire distributed lock
   */
  async acquireLock(lockKey, ttl = 60, timeout = 10000) {
    try {
      const client = await this.getClient();
      const cacheKey = this.generateKey('lock', lockKey);
      const lockValue = `${Date.now()}-${Math.random()}`;
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        const result = await client.set(cacheKey, lockValue, 'PX', ttl * 1000, 'NX');
        
        if (result === 'OK') {
          return {
            acquired: true,
            lockKey: cacheKey,
            lockValue,
            expiresAt: Date.now() + (ttl * 1000)
          };
        }
        
        // Wait sebelum retry
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return {
        acquired: false,
        lockKey: cacheKey,
        lockValue: null,
        expiresAt: null
      };
    } catch (error) {
      console.error('❌ Lock acquire error:', error);
      return { acquired: false, error: error.message };
    }
  }

  /**
   * Release distributed lock
   */
  async releaseLock(lockInfo) {
    try {
      if (!lockInfo.acquired || !lockInfo.lockKey || !lockInfo.lockValue) {
        return false;
      }

      const client = await this.getClient();
      
      // Lua script untuk atomic check-and-delete
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await client.eval(script, 1, lockInfo.lockKey, lockInfo.lockValue);
      return result === 1;
    } catch (error) {
      console.error('❌ Lock release error:', error);
      return false;
    }
  }

  // Utility Methods

  /**
   * Serialize value untuk cache storage
   */
  serializeValue(value) {
    try {
      if (typeof value === 'string') {
        return value;
      }
      
      const serialized = JSON.stringify(value);
      
      // Compress jika enabled dan value cukup besar
      if (this.config.enableCompression && serialized.length > 1000) {
        // Implement compression logic here
        return `compressed:${serialized}`;
      }
      
      return serialized;
    } catch (error) {
      console.error('❌ Value serialization error:', error);
      return String(value);
    }
  }

  /**
   * Deserialize value dari cache storage
   */
  deserializeValue(value) {
    try {
      if (typeof value !== 'string') {
        return value;
      }
      
      // Handle compressed values
      if (value.startsWith('compressed:')) {
        // Implement decompression logic here
        value = value.substring(11); // Remove 'compressed:' prefix
      }
      
      // Try to parse as JSON
      return JSON.parse(value);
    } catch (error) {
      // Return as string jika parsing gagal
      return value;
    }
  }

  /**
   * Update cache statistics
   */
  updateStats(operation, count = 1) {
    this.stats[operation] = (this.stats[operation] || 0) + count;
    this.stats.totalOperations += count;
  }

  /**
   * Get cache statistics
   */
  getStatistics() {
    const uptime = Date.now() - this.stats.startTime;
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    
    return {
      ...this.stats,
      hitRate: parseFloat((hitRate * 100).toFixed(2)),
      uptime,
      operationsPerSecond: this.stats.totalOperations / (uptime / 1000),
      config: this.config
    };
  }

  /**
   * Clear all cache
   */
  async clearAll() {
    try {
      const client = await this.getClient();
      const pattern = `${this.config.keyPrefix}:*`;
      
      const keys = await client.keys(pattern);
      
      if (keys.length > 0) {
        const result = await client.del(keys);
        this.updateStats('deletes', result);
        return result;
      }
      
      return 0;
    } catch (error) {
      this.updateStats('errors');
      console.error('❌ Cache clearAll error:', error);
      return 0;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const client = await this.getClient();
      await client.ping();
      return true;
    } catch (error) {
      console.error('❌ Cache health check failed:', error);
      return false;
    }
  }

  /**
   * Get cache info
   */
  async getInfo() {
    try {
      const client = await this.getClient();
      const info = await client.info();
      return {
        connected: true,
        info: info,
        statistics: this.getStatistics()
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        statistics: this.getStatistics()
      };
    }
  }
}

export default CacheService;