/**
 * Rate Limiting Middleware
 * 
 * Middleware untuk rate limiting menggunakan Redis
 * Supports different limits untuk different endpoints dan user tiers
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import rateLimit from 'express-rate-limit';
import StorageService from '../../services/storage.service.js';
import CacheService from '../../services/cache.service.js';

// Initialize services
const storageService = new StorageService();
const cacheService = new CacheService(storageService);

/**
 * Base rate limiter configuration
 */
const createRateLimiter = (options) => {
  const defaults = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.skipRateLimit === true,
    keyGenerator: (req) => {
      // Use user ID jika authenticated, otherwise IP
      return req.user?.id || req.ip;
    },
    message: {
      error: 'Too many requests',
      details: ['You have exceeded the rate limit. Please try again later.']
    },
    onLimitReached: (req, res, options) => {
      const identifier = req.user?.id || req.ip;
      console.log(`⚠️ Rate limit reached for ${identifier} on ${req.path}`);
    }
  };

  return rateLimit({
    ...defaults,
    ...options,
    store: new RedisStore() // Custom Redis store
  });
};

/**
 * Custom Redis store untuk rate limiting
 */
class RedisStore {
  constructor() {
    this.name = 'redis-store';
  }

  async increment(key) {
    try {
      const cache = await cacheService.getClient();
      const current = await cache.incr(`rate_limit:${key}`);
      
      // Set TTL on first increment
      if (current === 1) {
        await cache.expire(`rate_limit:${key}`, 900); // 15 minutes
      }
      
      return {
        totalHits: current,
        resetTime: new Date(Date.now() + 900000) // 15 minutes from now
      };
    } catch (error) {
      // Only log once, not every request
      if (!this.errorLogged) {
        console.warn('⚠️ Rate limiting disabled - Redis not available');
        this.errorLogged = true;
      }
      // Fail open - allow request if Redis is down
      return {
        totalHits: 1,
        resetTime: new Date(Date.now() + 900000)
      };
    }
  }

  async decrement(key) {
    try {
      const cache = await cacheService.getClient();
      const current = await cache.decr(`rate_limit:${key}`);
      return Math.max(0, current);
    } catch (error) {
      console.error('❌ Rate limit decrement error:', error);
      return 0;
    }
  }

  async resetKey(key) {
    try {
      const cache = await cacheService.getClient();
      await cache.del(`rate_limit:${key}`);
    } catch (error) {
      console.error('❌ Rate limit reset error:', error);
    }
  }
}

/**
 * Tier-based rate limiting
 * Adjusts limits berdasarkan subscription tier
 */
const createTieredRateLimiter = (baseOptions) => {
  return (req, res, next) => {
    let limits = baseOptions;

    // Adjust limits berdasarkan user tier
    if (req.user?.subscription?.tier) {
      const tier = req.user.subscription.tier;
      const multipliers = {
        basic: 1,
        pro: 3,
        enterprise: 10
      };

      const multiplier = multipliers[tier] || 1;
      limits = {
        ...baseOptions,
        max: Math.floor(baseOptions.max * multiplier)
      };
    }

    const limiter = createRateLimiter(limits);
    limiter(req, res, next);
  };
};

/**
 * Auth endpoints rate limiter
 * Stricter limits untuk authentication endpoints
 */
export const rateLimitAuth = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 requests per window
  message: {
    error: 'Too many authentication attempts',
    details: ['Please wait before trying again. This helps protect against brute force attacks.']
  },
  keyGenerator: (req) => {
    // Use IP untuk auth endpoints untuk prevent account enumeration
    return req.ip;
  }
});

/**
 * API endpoints rate limiter
 * General rate limiting untuk most API endpoints
 */
export const rateLimitApi = createTieredRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute for basic tier
  message: {
    error: 'API rate limit exceeded',
    details: ['You have made too many API requests. Please slow down.']
  }
});

/**
 * Notes endpoints rate limiter
 * Higher limits untuk notes operations
 */
export const rateLimitNotes = createTieredRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute for basic tier
  message: {
    error: 'Notes API rate limit exceeded',
    details: ['You have made too many notes requests. Please slow down.']
  }
});

/**
 * Search endpoints rate limiter
 * Moderate limits untuk search operations
 */
export const rateLimitSearch = createTieredRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // 50 searches per minute for basic tier
  message: {
    error: 'Search rate limit exceeded',
    details: ['You have performed too many searches. Please wait before searching again.']
  }
});

/**
 * Upload endpoints rate limiter
 * Very strict limits untuk file uploads
 */
export const rateLimitUpload = createTieredRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour for basic tier
  message: {
    error: 'Upload rate limit exceeded',
    details: ['You have uploaded too many files. Please wait before uploading again.']
  }
});

/**
 * Monitoring endpoints rate limiter
 * Restrictive limits untuk monitoring data
 */
export const rateLimitMonitoring = createTieredRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 requests per 5 minutes for basic tier
  message: {
    error: 'Monitoring API rate limit exceeded',
    details: ['You have made too many monitoring requests. Please reduce frequency.']
  }
});

/**
 * Global rate limiter
 * Catch-all untuk unspecified endpoints
 */
export const rateLimitGlobal = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  message: {
    error: 'Global rate limit exceeded',
    details: ['You have made too many requests to our API. Please slow down.']
  }
});

/**
 * Adaptive rate limiting
 * Adjusts limits berdasarkan system load
 */
export const adaptiveRateLimit = (baseOptions) => {
  return async (req, res, next) => {
    try {
      // Get system metrics
      const systemLoad = await getSystemLoad();
      const errorRate = await getErrorRate();

      // Adjust limits berdasarkan system health
      let adjustedMax = baseOptions.max;

      if (systemLoad > 0.8) {
        adjustedMax = Math.floor(adjustedMax * 0.5); // Reduce by 50% when high load
      } else if (systemLoad > 0.6) {
        adjustedMax = Math.floor(adjustedMax * 0.75); // Reduce by 25% when moderate load
      }

      if (errorRate > 0.1) {
        adjustedMax = Math.floor(adjustedMax * 0.6); // Reduce by 40% when high error rate
      }

      const limiter = createRateLimiter({
        ...baseOptions,
        max: adjustedMax
      });

      limiter(req, res, next);

    } catch (error) {
      console.error('❌ Adaptive rate limit error:', error);
      // Fallback to base limiter
      const limiter = createRateLimiter(baseOptions);
      limiter(req, res, next);
    }
  };
};

/**
 * Custom rate limiting dengan complex rules
 */
export const customRateLimit = (rules) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user?.id || req.ip;
      const userTier = req.user?.subscription?.tier || 'basic';
      const endpoint = req.path;

      // Find matching rule
      const matchingRule = rules.find(rule => {
        if (rule.endpoint && !endpoint.includes(rule.endpoint)) return false;
        if (rule.tier && rule.tier !== userTier) return false;
        if (rule.method && rule.method !== req.method) return false;
        return true;
      });

      if (!matchingRule) {
        return next(); // No matching rule, allow request
      }

      // Check rate limit using cache service
      const rateLimitResult = await cacheService.checkRateLimit(identifier, matchingRule.type || 'custom');

      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          details: [matchingRule.message || 'Too many requests'],
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          reset_time: rateLimitResult.resetTime,
          retry_after: rateLimitResult.retryAfter
        });
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': rateLimitResult.limit,
        'X-RateLimit-Remaining': rateLimitResult.remaining,
        'X-RateLimit-Reset': rateLimitResult.resetTime
      });

      next();

    } catch (error) {
      console.error('❌ Custom rate limit error:', error);
      // Fail open
      next();
    }
  };
};

/**
 * Rate limit bypass untuk trusted IPs
 */
export const bypassForTrustedIPs = (trustedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip;
    
    if (trustedIPs.includes(clientIP)) {
      req.skipRateLimit = true;
    }
    
    next();
  };
};

/**
 * Dynamic rate limiting berdasarkan endpoint popularity
 */
export const dynamicRateLimit = async (req, res, next) => {
  try {
    const endpoint = req.path;
    
    // Get endpoint popularity metrics
    const popularity = await getEndpointPopularity(endpoint);
    
    // Adjust rate limits berdasarkan popularity
    let multiplier = 1;
    if (popularity > 1000) {
      multiplier = 0.5; // Stricter limits untuk popular endpoints
    } else if (popularity < 100) {
      multiplier = 2; // Relaxed limits untuk less popular endpoints
    }

    // Apply dynamic rate limiting
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: Math.floor(100 * multiplier),
      message: {
        error: 'Dynamic rate limit exceeded',
        details: [`This endpoint has high traffic. Limit: ${Math.floor(100 * multiplier)} requests/minute`]
      }
    });

    limiter(req, res, next);

  } catch (error) {
    console.error('❌ Dynamic rate limit error:', error);
    next();
  }
};

// Helper functions

async function getSystemLoad() {
  try {
    // Get system load metrics (simplified)
    const memoryUsage = process.memoryUsage();
    const heapUsed = memoryUsage.heapUsed / memoryUsage.heapTotal;
    return heapUsed;
  } catch (error) {
    return 0.5; // Default moderate load
  }
}

async function getErrorRate() {
  try {
    // Calculate error rate dari recent requests (simplified)
    return Math.random() * 0.05; // Mock 0-5% error rate
  } catch (error) {
    return 0.02; // Default 2% error rate
  }
}

async function getEndpointPopularity(endpoint) {
  try {
    // Get endpoint request count dari cache
    const cache = await cacheService.getClient();
    const count = await cache.get(`endpoint_popularity:${endpoint}`) || 0;
    return parseInt(count);
  } catch (error) {
    return 500; // Default moderate popularity
  }
}

/**
 * Rate limit info endpoint
 * Returns current rate limit status for user
 */
export const getRateLimitInfo = async (req, res) => {
  try {
    const identifier = req.user?.id || req.ip;
    const userTier = req.user?.subscription?.tier || 'basic';

    // Get current rate limit status untuk different endpoints
    const authLimit = await cacheService.checkRateLimit(identifier, 'auth');
    const apiLimit = await cacheService.checkRateLimit(identifier, 'api');
    const searchLimit = await cacheService.checkRateLimit(identifier, 'search');

    res.json({
      user_tier: userTier,
      limits: {
        auth: {
          limit: authLimit.limit,
          remaining: authLimit.remaining,
          reset_time: authLimit.resetTime
        },
        api: {
          limit: apiLimit.limit,
          remaining: apiLimit.remaining,
          reset_time: apiLimit.resetTime
        },
        search: {
          limit: searchLimit.limit,
          remaining: searchLimit.remaining,
          reset_time: searchLimit.resetTime
        }
      },
      recommendations: generateRateLimitRecommendations(userTier, authLimit, apiLimit, searchLimit)
    });

  } catch (error) {
    console.error('❌ Get rate limit info error:', error);
    res.status(500).json({
      error: 'Unable to retrieve rate limit information'
    });
  }
};

function generateRateLimitRecommendations(tier, authLimit, apiLimit, searchLimit) {
  const recommendations = [];

  if (tier === 'basic' && (apiLimit.remaining < 10 || searchLimit.remaining < 5)) {
    recommendations.push('Consider upgrading to Pro tier for higher rate limits');
  }

  if (authLimit.remaining < 3) {
    recommendations.push('Authentication requests are running low. Implement token caching');
  }

  if (apiLimit.remaining < 20) {
    recommendations.push('API requests are running low. Consider implementing request batching');
  }

  return recommendations;
}

export default {
  rateLimitAuth,
  rateLimitApi,
  rateLimitNotes,
  rateLimitSearch,
  rateLimitUpload,
  rateLimitMonitoring,
  rateLimitGlobal,
  adaptiveRateLimit,
  customRateLimit,
  bypassForTrustedIPs,
  dynamicRateLimit,
  getRateLimitInfo
};