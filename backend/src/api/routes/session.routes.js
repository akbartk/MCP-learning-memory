/**
 * Session Routes
 * 
 * Routes untuk session management operations
 * Endpoints: /sessions, /sessions/:sessionId
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { Router } from 'express';
import Joi from 'joi';
import StorageService from '../../services/storage.service.js';
import CacheService from '../../services/cache.service.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { rateLimitApi } from '../middleware/rate-limit.middleware.js';
import { asyncHandler } from '../middleware/async-handler.middleware.js';

const router = Router();

// Initialize services
const storageService = new StorageService();
const cacheService = new CacheService(storageService);

// Apply authentication to all session routes
router.use(authenticate);

// Validation schemas
const createSessionSchema = Joi.object({
  agent_id: Joi.string().required()
    .messages({
      'any.required': 'Agent ID is required'
    }),
  context: Joi.object({
    project: Joi.string().optional(),
    environment: Joi.string().optional(),
    goals: Joi.array().items(Joi.string()).optional(),
    metadata: Joi.object().optional()
  }).optional()
});

const updateSessionSchema = Joi.object({
  status: Joi.string().valid('active', 'completed', 'timeout', 'paused').optional(),
  statistics: Joi.object({
    notes_created: Joi.number().integer().min(0).optional(),
    searches_performed: Joi.number().integer().min(0).optional(),
    duration_minutes: Joi.number().min(0).optional(),
    actions_completed: Joi.number().integer().min(0).optional(),
    errors_encountered: Joi.number().integer().min(0).optional(),
    knowledge_items_accessed: Joi.number().integer().min(0).optional()
  }).optional(),
  metadata: Joi.object().optional()
});

/**
 * POST /sessions
 * Start new session
 */
router.post('/',
  rateLimitApi,
  validateRequest(createSessionSchema),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { agent_id, context = {} } = req.body;
      const user = req.user;

      // Validate agent access
      const hasAgentAccess = await this.validateAgentAccess(user, agent_id);
      if (!hasAgentAccess) {
        return res.status(403).json({
          error: 'Access denied',
          details: ['You do not have access to this agent']
        });
      }

      // Check concurrent session limits
      const activeSessions = await this.getActiveSessionsCount(user.userId);
      const maxConcurrentSessions = this.getMaxConcurrentSessions(user.subscription?.tier);
      
      if (activeSessions >= maxConcurrentSessions) {
        return res.status(429).json({
          error: 'Session limit exceeded',
          details: [`Maximum ${maxConcurrentSessions} concurrent sessions allowed for ${user.subscription?.tier || 'basic'} tier`]
        });
      }

      // Create session data
      const sessionData = {
        agent_id,
        user_id: user.userId,
        context: {
          ...context,
          created_by: 'api',
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          subscription_tier: user.subscription?.tier || 'basic'
        }
      };

      // Create session
      const session = await storageService.createSession(sessionData);

      // Initialize session in cache
      await cacheService.setSession(session.id, {
        ...session,
        last_activity: new Date().toISOString(),
        activity_count: 0
      }, 24 * 60 * 60); // 24 hours

      // Track session creation
      await this.trackSessionMetrics('created', user.userId);

      // Log session creation
      console.log(`📝 New session created: ${session.id} for agent ${agent_id}`);

      const responseTime = Date.now() - startTime;

      res.status(201).json({
        message: 'Session created successfully',
        data: {
          ...session,
          session_info: {
            max_duration_hours: this.getMaxSessionDuration(user.subscription?.tier),
            auto_timeout_minutes: this.getAutoTimeoutMinutes(user.subscription?.tier),
            features_available: this.getSessionFeatures(user.subscription?.tier)
          }
        },
        metadata: {
          response_time_ms: responseTime,
          active_sessions: activeSessions + 1,
          session_limit: maxConcurrentSessions
        }
      });

    } catch (error) {
      console.error('❌ Session creation failed:', error);

      // Handle specific errors
      if (error.message.includes('Agent not found')) {
        return res.status(404).json({
          error: 'Agent not found',
          details: ['The specified agent does not exist']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to create session. Please try again later.']
      });
    }
  })
);

/**
 * PATCH /sessions/:sessionId
 * Update session status and statistics
 */
router.patch('/:sessionId',
  rateLimitApi,
  validateRequest(updateSessionSchema),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { sessionId } = req.params;
      const updates = req.body;
      const user = req.user;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(sessionId)) {
        return res.status(400).json({
          error: 'Invalid session ID',
          details: ['Session ID must be a valid UUID']
        });
      }

      // Get current session
      const currentSession = await cacheService.getSession(sessionId);
      if (!currentSession) {
        return res.status(404).json({
          error: 'Session not found',
          details: ['The specified session does not exist or has expired']
        });
      }

      // Validate session ownership
      if (currentSession.user_id !== user.userId) {
        return res.status(403).json({
          error: 'Access denied',
          details: ['You can only update your own sessions']
        });
      }

      // Prepare update data
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
        last_activity: new Date().toISOString()
      };

      // Handle status changes
      if (updates.status) {
        updateData.status_changed_at = new Date().toISOString();
        
        // Auto-calculate duration for completed sessions
        if (updates.status === 'completed' || updates.status === 'timeout') {
          const startTime = new Date(currentSession.started_at);
          const endTime = new Date();
          updateData.duration_minutes = Math.floor((endTime - startTime) / 60000);
          
          // Update session statistics
          if (!updateData.statistics) updateData.statistics = {};
          updateData.statistics.total_duration_minutes = updateData.duration_minutes;
        }
      }

      // Merge statistics
      if (updates.statistics) {
        updateData.statistics = {
          ...currentSession.statistics,
          ...updates.statistics,
          last_updated: new Date().toISOString()
        };
      }

      // Update session in storage
      const updatedSession = await storageService.updateSession(sessionId, updateData);

      // Update session cache
      await cacheService.updateSession(sessionId, updateData);

      // Track session metrics
      if (updates.status) {
        await this.trackSessionMetrics(updates.status, user.userId);
      }

      // Generate insights for completed sessions
      let insights = null;
      if (updates.status === 'completed' && updateData.statistics) {
        insights = this.generateSessionInsights(updatedSession);
      }

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Session updated successfully',
        data: {
          ...updatedSession,
          insights,
          performance_metrics: this.calculateSessionPerformance(updatedSession)
        },
        metadata: {
          response_time_ms: responseTime,
          update_timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Session update failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to update session. Please try again later.']
      });
    }
  })
);

/**
 * GET /sessions/:sessionId
 * Get session details
 */
router.get('/:sessionId',
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { sessionId } = req.params;
      const user = req.user;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(sessionId)) {
        return res.status(400).json({
          error: 'Invalid session ID',
          details: ['Session ID must be a valid UUID']
        });
      }

      // Try cache first
      let session = await cacheService.getSession(sessionId);
      
      if (!session) {
        // Fallback to storage
        session = await storageService.getSessionById(sessionId);
      }

      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          details: ['The specified session does not exist']
        });
      }

      // Validate session access
      if (session.user_id !== user.userId) {
        return res.status(403).json({
          error: 'Access denied',
          details: ['You can only access your own sessions']
        });
      }

      // Enrich with real-time data
      const enrichedSession = {
        ...session,
        real_time_stats: {
          is_active: session.status === 'active',
          time_since_last_activity: this.calculateTimeSinceActivity(session.last_activity),
          estimated_remaining_time: this.estimateRemainingTime(session),
          activity_level: this.calculateActivityLevel(session)
        },
        notes_summary: await this.getSessionNotesCount(sessionId),
        related_sessions: await this.getRelatedSessions(session.agent_id, sessionId)
      };

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Session retrieved successfully',
        data: enrichedSession,
        metadata: {
          response_time_ms: responseTime,
          data_freshness: session === await cacheService.getSession(sessionId) ? 'cached' : 'storage'
        }
      });

    } catch (error) {
      console.error('❌ Get session failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve session. Please try again later.']
      });
    }
  })
);

/**
 * GET /sessions
 * Get user's sessions with filtering and pagination
 */
router.get('/',
  rateLimitApi,
  validateRequest(Joi.object({
    status: Joi.string().valid('active', 'completed', 'timeout', 'paused').optional(),
    agent_id: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
    sort_by: Joi.string().valid('started_at', 'updated_at', 'duration_minutes').default('started_at'),
    sort_order: Joi.string().valid('asc', 'desc').default('desc')
  }), 'query'),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        status,
        agent_id,
        limit,
        offset,
        sort_by,
        sort_order
      } = req.query;

      const user = req.user;

      // Build cache key
      const cacheKey = `user_sessions:${user.userId}:${status || 'all'}:${agent_id || 'all'}:${limit}:${offset}:${sort_by}:${sort_order}`;
      
      // Try cache first
      const cachedResult = await cacheService.get(cacheKey);
      if (cachedResult) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Sessions retrieved successfully',
          data: cachedResult,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get sessions from storage
      const filters = { userId: user.userId };
      if (status) filters.status = status;
      if (agent_id) filters.agentId = agent_id;

      const sessions = await storageService.getUserSessions(filters);

      // Apply sorting
      sessions.sort((a, b) => {
        let aVal = a[sort_by];
        let bVal = b[sort_by];

        if (sort_by.includes('_at')) {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
        }

        if (sort_order === 'asc') {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });

      // Apply pagination
      const paginatedSessions = sessions.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );

      // Enrich with summary data
      const enrichedSessions = await Promise.all(
        paginatedSessions.map(async (session) => ({
          ...session,
          summary: {
            notes_count: await this.getSessionNotesCount(session.id),
            activity_score: this.calculateActivityScore(session),
            completion_percentage: this.calculateCompletionPercentage(session)
          }
        }))
      );

      const result = {
        sessions: enrichedSessions,
        pagination: {
          total: sessions.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: (parseInt(offset) + parseInt(limit)) < sessions.length
        },
        summary: {
          total_sessions: sessions.length,
          active_sessions: sessions.filter(s => s.status === 'active').length,
          completed_sessions: sessions.filter(s => s.status === 'completed').length,
          total_duration_hours: this.calculateTotalDuration(sessions),
          most_productive_session: this.findMostProductiveSession(sessions)
        },
        filters_applied: {
          status: status || null,
          agent_id: agent_id || null,
          sort_by,
          sort_order
        }
      };

      // Cache for 5 minutes
      await cacheService.setWithTags(
        cacheKey,
        result,
        [`user_sessions:${user.userId}`, 'sessions:all'],
        300
      );

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Sessions retrieved successfully',
        data: result,
        metadata: {
          response_time_ms: responseTime,
          cached: false
        }
      });

    } catch (error) {
      console.error('❌ Get sessions failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve sessions. Please try again later.']
      });
    }
  })
);

/**
 * DELETE /sessions/:sessionId
 * End/delete session
 */
router.delete('/:sessionId',
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { sessionId } = req.params;
      const user = req.user;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(sessionId)) {
        return res.status(400).json({
          error: 'Invalid session ID',
          details: ['Session ID must be a valid UUID']
        });
      }

      // Get session
      const session = await cacheService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          details: ['The specified session does not exist']
        });
      }

      // Validate session ownership
      if (session.user_id !== user.userId) {
        return res.status(403).json({
          error: 'Access denied',
          details: ['You can only delete your own sessions']
        });
      }

      // Update session status to completed if it was active
      if (session.status === 'active') {
        const endTime = new Date();
        const duration = Math.floor((endTime - new Date(session.started_at)) / 60000);
        
        await storageService.updateSession(sessionId, {
          status: 'completed',
          ended_at: endTime.toISOString(),
          duration_minutes: duration
        });
      }

      // Remove from cache
      await cacheService.deleteSession(sessionId);

      // Invalidate related caches
      await cacheService.invalidateByTags([
        `user_sessions:${user.userId}`,
        'sessions:all'
      ]);

      // Track session metrics
      await this.trackSessionMetrics('ended', user.userId);

      // Log session deletion
      console.log(`🗑️ Session ended: ${sessionId} by user ${user.userId}`);

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Session ended successfully',
        data: {
          session_id: sessionId,
          ended_at: new Date().toISOString(),
          final_status: 'completed'
        },
        metadata: {
          response_time_ms: responseTime
        }
      });

    } catch (error) {
      console.error('❌ End session failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to end session. Please try again later.']
      });
    }
  })
);

// Helper methods
router.validateAgentAccess = async (user, agentId) => {
  // Implement agent access validation logic
  return true; // Simplified for now
};

router.getActiveSessionsCount = async (userId) => {
  // Count active sessions for user
  const cacheKey = `active_sessions:${userId}`;
  let count = await cacheService.get(cacheKey);
  
  if (count === null) {
    // Count from storage and cache
    count = await storageService.getActiveSessionsCount(userId);
    await cacheService.set(cacheKey, count, 300); // 5 minutes
  }
  
  return count;
};

router.getMaxConcurrentSessions = (tier) => {
  const limits = {
    basic: 3,
    pro: 10,
    enterprise: 25
  };
  return limits[tier] || limits.basic;
};

router.getMaxSessionDuration = (tier) => {
  const hours = {
    basic: 8,
    pro: 24,
    enterprise: 72
  };
  return hours[tier] || hours.basic;
};

router.getAutoTimeoutMinutes = (tier) => {
  const minutes = {
    basic: 60,
    pro: 180,
    enterprise: 360
  };
  return minutes[tier] || minutes.basic;
};

router.getSessionFeatures = (tier) => {
  const features = {
    basic: ['note_creation', 'search'],
    pro: ['note_creation', 'search', 'advanced_analytics', 'export'],
    enterprise: ['note_creation', 'search', 'advanced_analytics', 'export', 'custom_integrations', 'priority_support']
  };
  return features[tier] || features.basic;
};

/**
 * Error handling middleware untuk session routes
 */
router.use((error, req, res, next) => {
  console.error('❌ Session route error:', error);

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(detail => detail.message)
    });
  }

  if (error.status === 429) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      details: ['Too many requests. Please try again later.'],
      retry_after: error.retryAfter
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    details: ['An unexpected error occurred']
  });
});

export default router;