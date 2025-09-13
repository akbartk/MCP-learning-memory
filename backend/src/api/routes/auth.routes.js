/**
 * Authentication Routes
 * 
 * Routes untuk subscriber registration dan token management
 * Endpoints: /auth/subscribe, /auth/token
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { Router } from 'express';
import Joi from 'joi';
import sharedServices from '../../services/shared-services.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import { rateLimitAuth } from '../middleware/rate-limit.middleware.js';
import { asyncHandler } from '../middleware/async-handler.middleware.js';

const router = Router();

// Validation schemas
const subscribeSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({
      'string.email': 'Email must be a valid email address',
      'any.required': 'Email is required'
    }),
  organization: Joi.string().min(2).max(100).required()
    .messages({
      'string.min': 'Organization must be at least 2 characters',
      'string.max': 'Organization must not exceed 100 characters',
      'any.required': 'Organization is required'
    }),
  tier: Joi.string().valid('basic', 'pro', 'enterprise').required()
    .messages({
      'any.only': 'Tier must be one of: basic, pro, enterprise',
      'any.required': 'Tier is required'
    })
});

const tokenSchema = Joi.object({
  api_key: Joi.string().required()
    .messages({
      'any.required': 'API key is required'
    })
});

/**
 * POST /auth/subscribe
 * Register new subscriber
 */
router.post('/subscribe', 
  rateLimitAuth,
  validateRequest(subscribeSchema),
  asyncHandler(async (req, res) => {
    const { email, organization, tier } = req.body;

    try {
      // Create subscription
      const authService = sharedServices.getAuthService();
      const subscription = await authService.subscribe({
        email,
        organization,
        tier
      });

      // Log subscription creation
      console.log(`✅ New subscription created: ${subscription.user_id} (${tier})`);

      res.status(201).json({
        message: 'Subscription created successfully',
        data: subscription
      });

    } catch (error) {
      console.error('❌ Subscription creation failed:', error);

      // Handle specific errors
      if (error.message.includes('Email already registered')) {
        return res.status(400).json({
          error: 'Email already registered',
          details: ['This email address is already associated with an existing subscription']
        });
      }

      if (error.message.includes('Invalid subscription tier')) {
        return res.status(400).json({
          error: 'Invalid subscription tier',
          details: ['Tier must be one of: basic, pro, enterprise']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to create subscription. Please try again later.']
      });
    }
  })
);

/**
 * POST /auth/token
 * Generate access token from API key
 */
router.post('/token',
  rateLimitAuth,
  validateRequest(tokenSchema),
  asyncHandler(async (req, res) => {
    const { api_key } = req.body;

    try {
      // Generate token
      const authService = sharedServices.getAuthService();
      const tokenResponse = await authService.generateToken(api_key);

      // Log token generation
      console.log(`🔑 Token generated for API key: ${api_key.substring(0, 8)}...`);

      res.status(200).json({
        message: 'Token generated successfully',
        data: tokenResponse
      });

    } catch (error) {
      console.error('❌ Token generation failed:', error);

      // Handle specific errors
      if (error.message.includes('Invalid API key')) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['Invalid API key provided']
        });
      }

      if (error.message.includes('User account is deactivated')) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['User account has been deactivated']
        });
      }

      if (error.message.includes('Subscription is not active')) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['Subscription is not active']
        });
      }

      if (error.message.includes('Subscription has expired')) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['Subscription has expired']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to generate token. Please try again later.']
      });
    }
  })
);

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh',
  rateLimitAuth,
  validateRequest(Joi.object({
    refresh_token: Joi.string().required()
      .messages({
        'any.required': 'Refresh token is required'
      })
  })),
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;

    try {
      // Refresh token
      const tokenResponse = await authService.refreshToken(refresh_token);

      res.status(200).json({
        message: 'Token refreshed successfully',
        data: tokenResponse
      });

    } catch (error) {
      console.error('❌ Token refresh failed:', error);

      // Handle specific errors
      if (error.message.includes('Invalid token type') || 
          error.message.includes('Token has expired') ||
          error.message.includes('Invalid signature')) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['Invalid or expired refresh token']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to refresh token. Please try again later.']
      });
    }
  })
);

/**
 * GET /auth/me
 * Get current user info from token
 */
router.get('/me',
  // Note: This would need authentication middleware
  asyncHandler(async (req, res) => {
    try {
      // Extract user from token (added by auth middleware)
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['No valid authentication token provided']
        });
      }

      // Get subscription details
      const subscription = await authService.getSubscription(user.userId);

      res.status(200).json({
        message: 'User information retrieved successfully',
        data: {
          user_id: user.userId,
          email: user.email,
          organization: user.organization,
          subscription: {
            tier: user.tier,
            status: subscription.status,
            agent_limit: subscription.agentLimit,
            expires_at: subscription.expiresAt,
            features: subscription.features
          }
        }
      });

    } catch (error) {
      console.error('❌ Get user info failed:', error);
      
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve user information']
      });
    }
  })
);

/**
 * POST /auth/revoke
 * Revoke API key (generate new one)
 */
router.post('/revoke',
  // Note: This would need authentication middleware
  asyncHandler(async (req, res) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized access',
          details: ['No valid authentication token provided']
        });
      }

      // Revoke current API key dan generate new one
      const newApiKey = await authService.revokeApiKey(user.userId);

      // Log API key revocation
      console.log(`🔑 API key revoked for user: ${user.userId}`);

      res.status(200).json({
        message: 'API key revoked successfully',
        data: {
          new_api_key: newApiKey,
          message: 'Please store the new API key securely. The old key is no longer valid.'
        }
      });

    } catch (error) {
      console.error('❌ API key revocation failed:', error);
      
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to revoke API key']
      });
    }
  })
);

/**
 * Error handling middleware untuk auth routes
 */
router.use((error, req, res, next) => {
  console.error('❌ Auth route error:', error);

  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(detail => detail.message)
    });
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Unauthorized access',
      details: ['Invalid authentication token']
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Unauthorized access',
      details: ['Authentication token has expired']
    });
  }

  // Generic error
  res.status(500).json({
    error: 'Internal server error',
    details: ['An unexpected error occurred']
  });
});

export default router;