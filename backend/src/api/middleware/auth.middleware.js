/**
 * Authentication Middleware
 * 
 * Middleware untuk JWT authentication dan authorization
 * Menggunakan AuthService untuk token validation
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import AuthService from '../../services/auth.service.js';
import StorageService from '../../services/storage.service.js';

// Initialize services
const storageService = new StorageService();
const authService = new AuthService(storageService);

/**
 * Main authentication middleware
 * Validates JWT token dan adds user info ke req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    // Extract token dari Authorization header
    const authHeader = req.get('Authorization');
    
    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized access',
        details: ['Authorization header is required']
      });
    }

    // Check Bearer token format
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
    if (!tokenMatch) {
      return res.status(401).json({
        error: 'Unauthorized access',
        details: ['Authorization header must be in format: Bearer <token>']
      });
    }

    const token = tokenMatch[1];

    // Validate token
    const validation = await authService.validateToken(token);
    
    if (!validation.valid) {
      let errorMessage = 'Invalid or expired token';
      
      if (validation.expired) {
        errorMessage = 'Token has expired';
      } else if (validation.error) {
        errorMessage = validation.error;
      }
      
      return res.status(401).json({
        error: 'Unauthorized access',
        details: [errorMessage]
      });
    }

    // Add user info ke request
    req.user = validation.user;
    req.tokenPayload = validation.payload;

    // Track authentication success
    req.authInfo = {
      authenticatedAt: new Date().toISOString(),
      tokenType: 'Bearer',
      userId: validation.user.id
    };

    next();

  } catch (error) {
    console.error('❌ Authentication middleware error:', error);
    
    return res.status(500).json({
      error: 'Authentication service error',
      details: ['Unable to validate authentication token']
    });
  }
};

/**
 * Optional authentication middleware
 * Adds user info jika token valid, tapi tidak require authentication
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.get('Authorization');
    
    if (!authHeader) {
      // No auth header, continue without user info
      return next();
    }

    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
    if (!tokenMatch) {
      // Invalid format, continue without user info
      return next();
    }

    const token = tokenMatch[1];
    const validation = await authService.validateToken(token);
    
    if (validation.valid) {
      req.user = validation.user;
      req.tokenPayload = validation.payload;
      req.authInfo = {
        authenticatedAt: new Date().toISOString(),
        tokenType: 'Bearer',
        userId: validation.user.id
      };
    }

    next();

  } catch (error) {
    console.error('❌ Optional auth middleware error:', error);
    // Continue without authentication on error
    next();
  }
};

/**
 * Authorization middleware untuk subscription tiers
 */
export const requireTier = (requiredTier) => {
  const tierLevels = {
    basic: 1,
    pro: 2,
    enterprise: 3
  };

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized access',
        details: ['Authentication required']
      });
    }

    const userTier = req.user.subscription?.tier || 'basic';
    const userLevel = tierLevels[userTier] || 0;
    const requiredLevel = tierLevels[requiredTier] || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: 'Insufficient subscription tier',
        details: [`This feature requires ${requiredTier} subscription or higher`],
        current_tier: userTier,
        required_tier: requiredTier
      });
    }

    next();
  };
};

/**
 * Authorization middleware untuk specific features
 */
export const requireFeature = (featureName) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized access',
        details: ['Authentication required']
      });
    }

    const userFeatures = req.user.subscription?.features || [];
    
    if (!userFeatures.includes(featureName)) {
      return res.status(403).json({
        error: 'Feature not available',
        details: [`Feature '${featureName}' is not available in your subscription`],
        available_features: userFeatures
      });
    }

    next();
  };
};

/**
 * Agent access validation middleware
 */
export const validateAgentAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized access',
        details: ['Authentication required']
      });
    }

    const agentId = req.params.agentId || req.body.agent_id || req.query.agent_id;
    
    if (!agentId) {
      return res.status(400).json({
        error: 'Missing agent ID',
        details: ['Agent ID is required for this operation']
      });
    }

    // Validate agent access (simplified - in production would check ownership/permissions)
    const hasAccess = await validateUserAgentAccess(req.user.id, agentId);
    
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied',
        details: ['You do not have access to this agent']
      });
    }

    req.agentId = agentId;
    next();

  } catch (error) {
    console.error('❌ Agent access validation error:', error);
    
    return res.status(500).json({
      error: 'Access validation error',
      details: ['Unable to validate agent access']
    });
  }
};

/**
 * Session validation middleware
 */
export const validateSessionAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized access',
        details: ['Authentication required']
      });
    }

    const sessionId = req.params.sessionId || req.body.session_id;
    
    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing session ID',
        details: ['Session ID is required for this operation']
      });
    }

    // Validate session ownership
    const hasAccess = await validateUserSessionAccess(req.user.id, sessionId);
    
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied',
        details: ['You do not have access to this session']
      });
    }

    req.sessionId = sessionId;
    next();

  } catch (error) {
    console.error('❌ Session access validation error:', error);
    
    return res.status(500).json({
      error: 'Access validation error',
      details: ['Unable to validate session access']
    });
  }
};

/**
 * Rate limit bypass untuk admin users
 */
export const bypassRateLimitForAdmin = (req, res, next) => {
  if (req.user && req.user.subscription?.tier === 'enterprise') {
    req.skipRateLimit = true;
  }
  next();
};

/**
 * Request logging middleware untuk authenticated requests
 */
export const logAuthenticatedRequest = (req, res, next) => {
  if (req.user) {
    console.log(`🔐 Authenticated request: ${req.method} ${req.path} by user ${req.user.id} (${req.user.subscription?.tier || 'basic'})`);
  }
  next();
};

/**
 * Subscription expiry check middleware
 */
export const checkSubscriptionExpiry = (req, res, next) => {
  if (!req.user) {
    return next(); // Skip jika tidak authenticated
  }

  const subscription = req.user.subscription;
  if (!subscription) {
    return res.status(403).json({
      error: 'No subscription found',
      details: ['User account requires an active subscription']
    });
  }

  if (subscription.status !== 'active') {
    return res.status(403).json({
      error: 'Subscription inactive',
      details: ['Your subscription is not active'],
      subscription_status: subscription.status
    });
  }

  if (subscription.expiresAt && new Date(subscription.expiresAt) < new Date()) {
    return res.status(403).json({
      error: 'Subscription expired',
      details: ['Your subscription has expired'],
      expired_at: subscription.expiresAt
    });
  }

  next();
};

/**
 * API key authentication (alternative to JWT)
 */
export const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.get('X-API-Key');
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        details: ['X-API-Key header is required']
      });
    }

    // Generate token dari API key
    const tokenResponse = await authService.generateToken(apiKey);
    
    if (!tokenResponse) {
      return res.status(401).json({
        error: 'Invalid API key',
        details: ['The provided API key is invalid']
      });
    }

    // Validate generated token untuk get user info
    const validation = await authService.validateToken(tokenResponse.access_token);
    
    if (!validation.valid) {
      return res.status(401).json({
        error: 'Authentication failed',
        details: ['Unable to authenticate with provided API key']
      });
    }

    req.user = validation.user;
    req.authInfo = {
      authenticatedAt: new Date().toISOString(),
      tokenType: 'API-Key',
      userId: validation.user.id
    };

    next();

  } catch (error) {
    console.error('❌ API key authentication error:', error);
    
    return res.status(500).json({
      error: 'Authentication service error',
      details: ['Unable to validate API key']
    });
  }
};

// Helper functions

/**
 * Validate if user has access to specific agent
 */
async function validateUserAgentAccess(userId, agentId) {
  try {
    // Simplified implementation - in production would check database
    // For now, assume user has access to their own agents
    return true;
  } catch (error) {
    console.error('❌ Agent access validation error:', error);
    return false;
  }
}

/**
 * Validate if user has access to specific session
 */
async function validateUserSessionAccess(userId, sessionId) {
  try {
    // Get session dari storage dan check ownership
    const session = await storageService.getSessionById(sessionId);
    return session && session.user_id === userId;
  } catch (error) {
    console.error('❌ Session access validation error:', error);
    return false;
  }
}

export default {
  authenticate,
  optionalAuth,
  requireTier,
  requireFeature,
  validateAgentAccess,
  validateSessionAccess,
  bypassRateLimitForAdmin,
  logAuthenticatedRequest,
  checkSubscriptionExpiry,
  authenticateApiKey
};