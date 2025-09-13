/**
 * Auth Middleware - Express Authentication Middleware
 * 
 * Menyediakan middleware untuk Express.js authentication
 * Mendukung JWT token validation dan authorization
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import authLib from './index.js';

/**
 * Extract token dari request headers
 * @param {Object} req - Express request object
 * @returns {string|null} JWT token atau null
 */
function extractToken(req) {
  // Check Authorization header (Bearer token)
  if (req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }
  }

  // Check cookies
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }

  // Check query parameter (tidak disarankan untuk production)
  if (req.query && req.query.token) {
    return req.query.token;
  }

  return null;
}

/**
 * Middleware untuk memverifikasi JWT token
 * @param {Object} options - Opsi middleware
 * @returns {Function} Express middleware
 */
export function authenticate(options = {}) {
  const {
    required = true,
    excludePaths = [],
    customExtractor = null,
    onSuccess = null,
    onFailure = null
  } = options;

  return async (req, res, next) => {
    try {
      // Skip authentication untuk excluded paths
      if (excludePaths.some(path => {
        if (typeof path === 'string') return req.path === path;
        if (path instanceof RegExp) return path.test(req.path);
        return false;
      })) {
        return next();
      }

      // Extract token
      const token = customExtractor ? customExtractor(req) : extractToken(req);

      if (!token) {
        if (!required) {
          req.user = null;
          return next();
        }

        const error = new Error('No authentication token provided');
        error.status = 401;
        error.code = 'NO_TOKEN';
        
        if (onFailure) onFailure(error, req, res);
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          code: 'NO_TOKEN'
        });
      }

      // Validate token
      const validation = authLib.validateToken(token);

      if (!validation.valid) {
        const error = new Error(validation.error);
        error.status = validation.expired ? 401 : 403;
        error.code = validation.expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
        
        if (onFailure) onFailure(error, req, res);
        
        return res.status(error.status).json({
          success: false,
          error: validation.error,
          code: error.code,
          expired: validation.expired
        });
      }

      // Attach user data ke request
      req.user = validation.payload;
      req.token = token;

      // Get token expiration info
      const expiration = authLib.getTokenExpiration(token);
      req.tokenExpiration = expiration;

      // Warning jika token akan expire dalam 5 menit
      if (expiration.timeLeft < 5 * 60 * 1000 && !expiration.expired) {
        res.set('X-Token-Warning', 'Token will expire soon');
        res.set('X-Token-Expires-In', expiration.timeLeftFormatted);
      }

      if (onSuccess) onSuccess(req.user, req, res);
      next();
    } catch (error) {
      console.error('Authentication middleware error:', error);
      
      if (onFailure) onFailure(error, req, res);
      
      return res.status(500).json({
        success: false,
        error: 'Internal authentication error',
        code: 'AUTH_ERROR'
      });
    }
  };
}

/**
 * Middleware untuk authorize berdasarkan roles
 * @param {Array|string} roles - Required roles
 * @param {Object} options - Opsi authorization
 * @returns {Function} Express middleware
 */
export function authorize(roles, options = {}) {
  const normalizedRoles = Array.isArray(roles) ? roles : [roles];
  const { requireAll = false } = options;

  return (req, res, next) => {
    // Check jika user sudah authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for authorization',
        code: 'NO_AUTH'
      });
    }

    const userRoles = req.user.roles || [];
    
    // Check authorization
    const hasRole = requireAll 
      ? normalizedRoles.every(role => userRoles.includes(role))
      : normalizedRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: normalizedRoles,
        userRoles
      });
    }

    next();
  };
}

/**
 * Middleware untuk check specific permissions
 * @param {string} permission - Required permission
 * @param {Object} options - Opsi permission check
 * @returns {Function} Express middleware
 */
export function requirePermission(permission, options = {}) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }

    const userPermissions = req.user.permissions || [];
    
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: `Permission '${permission}' required`,
        code: 'PERMISSION_DENIED',
        required: permission,
        userPermissions
      });
    }

    next();
  };
}

/**
 * Middleware untuk optional authentication
 * User data akan available jika token valid, tapi tidak required
 */
export const optionalAuth = authenticate({ required: false });

/**
 * Middleware untuk strict authentication
 * Token wajib ada dan valid
 */
export const requireAuth = authenticate({ required: true });

/**
 * Middleware untuk admin authorization
 */
export const requireAdmin = [
  requireAuth,
  authorize(['admin'])
];

/**
 * Middleware untuk refresh token validation
 */
export function validateRefreshToken() {
  return async (req, res, next) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token required',
          code: 'NO_REFRESH_TOKEN'
        });
      }

      const validation = authLib.validateToken(refreshToken);

      if (!validation.valid) {
        return res.status(401).json({
          success: false,
          error: validation.error,
          code: validation.expired ? 'REFRESH_TOKEN_EXPIRED' : 'INVALID_REFRESH_TOKEN'
        });
      }

      // Check jika ini benar-benar refresh token
      if (validation.payload.type !== 'refresh') {
        return res.status(400).json({
          success: false,
          error: 'Invalid token type. Expected refresh token.',
          code: 'INVALID_TOKEN_TYPE'
        });
      }

      req.refreshTokenPayload = validation.payload;
      next();
    } catch (error) {
      console.error('Refresh token validation error:', error);
      
      return res.status(500).json({
        success: false,
        error: 'Internal refresh token validation error',
        code: 'REFRESH_TOKEN_ERROR'
      });
    }
  };
}

/**
 * Middleware untuk rate limiting per user
 * @param {Object} options - Rate limiting options
 * @returns {Function} Express middleware
 */
export function userRateLimit(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // requests per window
    message = 'Too many requests from this user'
  } = options;

  const userRequests = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next(); // Skip jika tidak authenticated
    }

    const userId = req.user.sub || req.user.userId;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get atau create user request history
    if (!userRequests.has(userId)) {
      userRequests.set(userId, []);
    }

    const requests = userRequests.get(userId);
    
    // Remove old requests
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    userRequests.set(userId, recentRequests);

    // Check limit
    if (recentRequests.length >= max) {
      return res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // Add current request
    recentRequests.push(now);
    next();
  };
}

/**
 * Error handler untuk authentication errors
 */
export function authErrorHandler(err, req, res, next) {
  if (err.code && err.code.startsWith('AUTH_') || err.code && err.code.includes('TOKEN')) {
    return res.status(err.status || 401).json({
      success: false,
      error: err.message,
      code: err.code
    });
  }
  
  next(err);
}

export default {
  authenticate,
  authorize,
  requirePermission,
  optionalAuth,
  requireAuth,
  requireAdmin,
  validateRefreshToken,
  userRateLimit,
  authErrorHandler
};