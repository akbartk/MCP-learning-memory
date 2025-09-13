/**
 * Async Handler Middleware
 * 
 * Wrapper untuk async route handlers untuk automatic error handling
 * Prevents unhandled promise rejections dalam Express routes
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

/**
 * Async handler wrapper
 * Wraps async functions to automatically catch dan forward errors to Express error handler
 * 
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    // Execute function dan catch any errors
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Async middleware wrapper dengan timeout
 * Adds timeout protection untuk long-running operations
 * 
 * @param {Function} fn - Async function to wrap  
 * @param {number} timeoutMs - Timeout dalam milliseconds (default: 30000)
 * @returns {Function} Express middleware function
 */
export const asyncHandlerWithTimeout = (fn, timeoutMs = 30000) => {
  return (req, res, next) => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const functionPromise = Promise.resolve(fn(req, res, next));

    Promise.race([functionPromise, timeoutPromise]).catch(next);
  };
};

/**
 * Async handler dengan retry logic
 * Automatically retries failed operations
 * 
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Retry options
 * @returns {Function} Express middleware function
 */
export const asyncHandlerWithRetry = (fn, options = {}) => {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryOnError = (error) => error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT'
  } = options;

  return async (req, res, next) => {
    let attempt = 0;
    let lastError;

    while (attempt <= maxRetries) {
      try {
        await fn(req, res, next);
        return; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        attempt++;

        // Check if error should trigger retry
        if (attempt > maxRetries || !retryOnError(error)) {
          break;
        }

        // Log retry attempt
        console.log(`🔄 Retry attempt ${attempt}/${maxRetries} for ${req.method} ${req.path}: ${error.message}`);

        // Wait before retrying
        if (attempt <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }

    // All retries failed, forward error
    next(lastError);
  };
};

/**
 * Async handler dengan performance monitoring
 * Tracks execution time dan logs slow operations
 * 
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Monitoring options
 * @returns {Function} Express middleware function
 */
export const asyncHandlerWithMonitoring = (fn, options = {}) => {
  const {
    slowThreshold = 1000, // Log operations slower than 1 second
    enableMetrics = true,
    logSlowOperations = true
  } = options;

  return async (req, res, next) => {
    const startTime = Date.now();
    const operationId = `${req.method}:${req.path}:${Date.now()}`;

    try {
      // Add performance tracking ke request
      req.performanceMonitor = {
        operationId,
        startTime,
        markers: {}
      };

      // Execute function
      await fn(req, res, next);

      const duration = Date.now() - startTime;

      // Log slow operations
      if (logSlowOperations && duration > slowThreshold) {
        console.log(`⚡ Slow operation detected: ${req.method} ${req.path} took ${duration}ms`);
      }

      // Record metrics jika enabled
      if (enableMetrics) {
        recordOperationMetrics(req.method, req.path, duration, true);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record error metrics
      if (enableMetrics) {
        recordOperationMetrics(req.method, req.path, duration, false);
      }

      // Log error dengan context
      console.error(`❌ Operation failed: ${req.method} ${req.path} (${duration}ms)`, error);

      next(error);
    }
  };
};

/**
 * Async handler dengan rate limiting integration
 * Integrates dengan rate limiting untuk better error handling
 * 
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
export const asyncHandlerWithRateLimit = (fn) => {
  return async (req, res, next) => {
    try {
      // Check if request was rate limited
      if (req.rateLimited) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          details: ['Too many requests. Please try again later.'],
          retry_after: req.rateLimitRetryAfter
        });
      }

      await fn(req, res, next);

    } catch (error) {
      // Handle rate limit related errors specially
      if (error.message.includes('rate limit') || error.status === 429) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          details: [error.message || 'Too many requests']
        });
      }

      next(error);
    }
  };
};

/**
 * Async handler dengan request validation
 * Adds additional request validation
 * 
 * @param {Function} fn - Async function to wrap
 * @param {Object} validationOptions - Validation options
 * @returns {Function} Express middleware function
 */
export const asyncHandlerWithValidation = (fn, validationOptions = {}) => {
  const {
    requireAuth = true,
    requireBody = false,
    requireQuery = false,
    maxBodySize = 1024 * 1024 // 1MB
  } = validationOptions;

  return async (req, res, next) => {
    try {
      // Authentication check
      if (requireAuth && !req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          details: ['This endpoint requires authentication']
        });
      }

      // Body validation
      if (requireBody && (!req.body || Object.keys(req.body).length === 0)) {
        return res.status(400).json({
          error: 'Request body required',
          details: ['This endpoint requires a request body']
        });
      }

      // Query validation
      if (requireQuery && (!req.query || Object.keys(req.query).length === 0)) {
        return res.status(400).json({
          error: 'Query parameters required',
          details: ['This endpoint requires query parameters']
        });
      }

      // Body size check
      if (req.body && JSON.stringify(req.body).length > maxBodySize) {
        return res.status(413).json({
          error: 'Request body too large',
          details: [`Request body must not exceed ${Math.round(maxBodySize / 1024)}KB`]
        });
      }

      await fn(req, res, next);

    } catch (error) {
      next(error);
    }
  };
};

/**
 * Async handler dengan caching integration
 * Integrates dengan caching untuk better performance
 * 
 * @param {Function} fn - Async function to wrap
 * @param {Object} cacheOptions - Cache options
 * @returns {Function} Express middleware function
 */
export const asyncHandlerWithCache = (fn, cacheOptions = {}) => {
  const {
    cacheKey = (req) => `${req.method}:${req.path}:${JSON.stringify(req.query)}`,
    cacheTTL = 300, // 5 minutes
    enableCache = true,
    cacheOnlySuccess = true
  } = cacheOptions;

  return async (req, res, next) => {
    try {
      let cacheKeyString = '';
      
      if (enableCache && req.method === 'GET') {
        cacheKeyString = typeof cacheKey === 'function' ? cacheKey(req) : cacheKey;
        
        // Try to get dari cache first
        const cached = req.cache ? await req.cache.get(cacheKeyString) : null;
        if (cached) {
          return res.json({
            ...cached,
            _cached: true,
            _cache_age: Math.floor((Date.now() - cached._timestamp) / 1000)
          });
        }
      }

      // Store original json function
      const originalJson = res.json;
      
      // Override json function untuk cache response
      if (enableCache && req.method === 'GET') {
        res.json = function(data) {
          // Cache successful responses
          if (cacheOnlySuccess && res.statusCode >= 200 && res.statusCode < 300) {
            const cacheData = {
              ...data,
              _timestamp: Date.now()
            };
            
            if (req.cache) {
              req.cache.set(cacheKeyString, cacheData, cacheTTL).catch(err => {
                console.error('❌ Cache set error:', err);
              });
            }
          }
          
          // Call original json function
          originalJson.call(this, data);
        };
      }

      await fn(req, res, next);

    } catch (error) {
      next(error);
    }
  };
};

/**
 * Record operation metrics (simplified implementation)
 */
function recordOperationMetrics(method, path, duration, success) {
  // In production, this would send metrics ke monitoring system
  const metric = {
    method,
    path,
    duration,
    success,
    timestamp: new Date().toISOString()
  };
  
  // For now, just log to console
  if (!success || duration > 1000) {
    console.log('📊 Operation metric:', JSON.stringify(metric));
  }
}

/**
 * Create performance marker untuk detailed timing
 */
export const createPerformanceMarker = (req, markerName) => {
  if (req.performanceMonitor) {
    req.performanceMonitor.markers[markerName] = Date.now();
  }
};

/**
 * Get performance timing information
 */
export const getPerformanceTiming = (req) => {
  if (!req.performanceMonitor) {
    return null;
  }

  const monitor = req.performanceMonitor;
  const totalDuration = Date.now() - monitor.startTime;
  
  const timings = {
    total_duration_ms: totalDuration,
    markers: {}
  };

  // Calculate marker durations
  let previousTime = monitor.startTime;
  Object.entries(monitor.markers).forEach(([name, time]) => {
    timings.markers[name] = {
      duration_ms: time - previousTime,
      timestamp: time
    };
    previousTime = time;
  });

  return timings;
};

export default {
  asyncHandler,
  asyncHandlerWithTimeout,
  asyncHandlerWithRetry,
  asyncHandlerWithMonitoring,
  asyncHandlerWithRateLimit,
  asyncHandlerWithValidation,
  asyncHandlerWithCache,
  createPerformanceMarker,
  getPerformanceTiming
};