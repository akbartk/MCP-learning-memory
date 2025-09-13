/**
 * Notes Routes
 * 
 * Routes untuk notes operations (create, retrieve, search)
 * Endpoints: /notes, /notes/search, /notes/relevant
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { Router } from 'express';
import Joi from 'joi';
import StorageService from '../../services/storage.service.js';
import SearchService from '../../services/search.service.js';
import CacheService from '../../services/cache.service.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { rateLimitNotes } from '../middleware/rate-limit.middleware.js';
import { asyncHandler } from '../middleware/async-handler.middleware.js';

const router = Router();

// Initialize services
const storageService = new StorageService();
const searchService = new SearchService(storageService);
const cacheService = new CacheService(storageService);

// Apply authentication to all notes routes
router.use(authenticate);

// Validation schemas
const createNoteSchema = Joi.object({
  agent_id: Joi.string().required()
    .messages({
      'any.required': 'Agent ID is required'
    }),
  session_id: Joi.string().uuid().optional()
    .messages({
      'string.uuid': 'Session ID must be a valid UUID'
    }),
  type: Joi.string().valid('build', 'development', 'bugfix', 'improvement').required()
    .messages({
      'any.only': 'Type must be one of: build, development, bugfix, improvement',
      'any.required': 'Type is required'
    }),
  context: Joi.object({
    task: Joi.string().required(),
    project: Joi.string().optional(),
    tags: Joi.array().items(Joi.string()).optional()
  }).required()
    .messages({
      'any.required': 'Context is required'
    }),
  content: Joi.object({
    action: Joi.string().min(10).required()
      .messages({
        'string.min': 'Action must be at least 10 characters',
        'any.required': 'Action is required'
      }),
    result: Joi.string().optional(),
    learning: Joi.string().optional(),
    errors: Joi.array().items(Joi.string()).optional(),
    solution: Joi.string().optional()
  }).required()
    .messages({
      'any.required': 'Content is required'
    })
});

const searchSchema = Joi.object({
  query: Joi.string().required()
    .messages({
      'any.required': 'Query is required'
    }),
  agent_id: Joi.string().required()
    .messages({
      'any.required': 'Agent ID is required'
    }),
  limit: Joi.number().integer().min(1).max(100).default(10)
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 100'
    }),
  min_relevance: Joi.number().min(0).max(1).default(0.5)
    .messages({
      'number.min': 'Min relevance must be at least 0',
      'number.max': 'Min relevance must not exceed 1'
    })
});

const relevantNotesSchema = Joi.object({
  task_description: Joi.string().required()
    .messages({
      'any.required': 'Task description is required'
    }),
  agent_id: Joi.string().required()
    .messages({
      'any.required': 'Agent ID is required'
    }),
  max_results: Joi.number().integer().min(1).max(100).default(20)
    .messages({
      'number.min': 'Max results must be at least 1',
      'number.max': 'Max results must not exceed 100'
    })
});

const getNotesSchema = Joi.object({
  agent_id: Joi.string().required()
    .messages({
      'any.required': 'Agent ID is required'
    }),
  limit: Joi.number().integer().min(1).max(1000).default(100)
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 1000'
    }),
  offset: Joi.number().integer().min(0).default(0)
    .messages({
      'number.min': 'Offset must be at least 0'
    }),
  from_date: Joi.date().iso().optional(),
  to_date: Joi.date().iso().optional()
});

/**
 * POST /notes
 * Store new note
 */
router.post('/',
  rateLimitNotes,
  validateRequest(createNoteSchema),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const noteData = req.body;
      const user = req.user;

      // Add metadata
      const enrichedNoteData = {
        ...noteData,
        metadata: {
          user_id: user.userId,
          created_by: 'api',
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          ...noteData.metadata
        }
      };

      // Save note
      const savedNote = await storageService.saveNote(enrichedNoteData);

      // Invalidate relevant caches
      await cacheService.invalidateByTags([
        `agent:${noteData.agent_id}`,
        `notes:recent`
      ]);

      // Log note creation
      console.log(`✅ Note created: ${savedNote.id} by agent ${noteData.agent_id}`);

      const responseTime = Date.now() - startTime;

      res.status(201).json({
        message: 'Note created successfully',
        data: savedNote,
        metadata: {
          response_time_ms: responseTime
        }
      });

    } catch (error) {
      console.error('❌ Note creation failed:', error);

      // Handle specific errors
      if (error.message.includes('agent_id')) {
        return res.status(400).json({
          error: 'Invalid agent ID',
          details: ['Agent ID must be provided and valid']
        });
      }

      if (error.message.includes('session_id')) {
        return res.status(400).json({
          error: 'Invalid session ID',
          details: ['Session ID must be a valid UUID if provided']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to create note. Please try again later.']
      });
    }
  })
);

/**
 * GET /notes
 * Get notes by agent with pagination and filtering
 */
router.get('/',
  rateLimitNotes,
  validateRequest(getNotesSchema, 'query'),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        agent_id,
        limit,
        offset,
        from_date,
        to_date
      } = req.query;

      const user = req.user;

      // Check if user has access to this agent's notes
      // This would depend on your access control logic
      // For now, we'll allow access

      // Try cache first
      const cacheKey = `notes:${agent_id}:${limit}:${offset}:${from_date || ''}:${to_date || ''}`;
      const cachedResult = await cacheService.get(cacheKey);

      if (cachedResult) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          ...cachedResult,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get notes from storage
      const options = {
        limit: parseInt(limit),
        offset: parseInt(offset)
      };

      if (from_date) options.fromDate = from_date;
      if (to_date) options.toDate = to_date;

      const result = await storageService.getNotesByAgent(agent_id, options);

      // Cache result for 5 minutes
      await cacheService.setWithTags(cacheKey, result, [`agent:${agent_id}`], 300);

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Notes retrieved successfully',
        data: result,
        metadata: {
          response_time_ms: responseTime,
          cached: false
        }
      });

    } catch (error) {
      console.error('❌ Get notes failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve notes. Please try again later.']
      });
    }
  })
);

/**
 * POST /notes/search
 * Semantic search for notes
 */
router.post('/search',
  rateLimitNotes,
  validateRequest(searchSchema),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const searchParams = req.body;
      const user = req.user;

      // Execute search
      const searchResult = await searchService.searchNotes(searchParams);

      // Add response time header
      res.set('X-Response-Time', `${searchResult.query_time_ms}ms`);

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Search completed successfully',
        data: searchResult,
        metadata: {
          response_time_ms: responseTime,
          search_method: 'semantic',
          user_id: user.userId
        }
      });

    } catch (error) {
      console.error('❌ Notes search failed:', error);

      // Handle specific search errors
      if (error.message.includes('Invalid query')) {
        return res.status(400).json({
          error: 'Invalid search query',
          details: ['Search query must be provided and valid']
        });
      }

      if (error.message.includes('Agent not found')) {
        return res.status(404).json({
          error: 'Agent not found',
          details: ['The specified agent ID does not exist']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Search failed. Please try again later.']
      });
    }
  })
);

/**
 * POST /notes/relevant
 * Get relevant notes for task
 */
router.post('/relevant',
  rateLimitNotes,
  validateRequest(relevantNotesSchema),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const params = req.body;
      const user = req.user;

      // Get relevant notes
      const result = await searchService.getRelevantNotes(params);

      // Add response headers
      res.set('X-Response-Time', `${Date.now() - startTime}ms`);
      res.set('X-Cache-Hit', result.cache_hit);

      res.status(200).json({
        message: 'Relevant notes retrieved successfully',
        data: result,
        metadata: {
          response_time_ms: Date.now() - startTime,
          user_id: user.userId,
          task_analysis: {
            patterns_detected: result.patterns_detected.length,
            notes_found: result.notes.length
          }
        }
      });

    } catch (error) {
      console.error('❌ Get relevant notes failed:', error);

      // Handle specific errors
      if (error.message.includes('Task description')) {
        return res.status(400).json({
          error: 'Invalid task description',
          details: ['Task description must be provided and descriptive']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to find relevant notes. Please try again later.']
      });
    }
  })
);

/**
 * GET /notes/:noteId
 * Get specific note by ID
 */
router.get('/:noteId',
  rateLimitNotes,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { noteId } = req.params;
      const user = req.user;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(noteId)) {
        return res.status(400).json({
          error: 'Invalid note ID',
          details: ['Note ID must be a valid UUID']
        });
      }

      // Try cache first
      const cacheKey = `note:${noteId}`;
      const cachedNote = await cacheService.get(cacheKey);

      if (cachedNote) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Note retrieved successfully',
          data: cachedNote,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get note from storage
      const note = await storageService.getNoteById(noteId);

      if (!note) {
        return res.status(404).json({
          error: 'Note not found',
          details: ['The specified note does not exist']
        });
      }

      // Cache note for 10 minutes
      await cacheService.set(cacheKey, note, 600);

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Note retrieved successfully',
        data: note,
        metadata: {
          response_time_ms: responseTime,
          cached: false
        }
      });

    } catch (error) {
      console.error('❌ Get note failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve note. Please try again later.']
      });
    }
  })
);

/**
 * DELETE /notes/:noteId
 * Delete specific note by ID
 */
router.delete('/:noteId',
  rateLimitNotes,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { noteId } = req.params;
      const user = req.user;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(noteId)) {
        return res.status(400).json({
          error: 'Invalid note ID',
          details: ['Note ID must be a valid UUID']
        });
      }

      // Get note first to check ownership
      const note = await storageService.getNoteById(noteId);

      if (!note) {
        return res.status(404).json({
          error: 'Note not found',
          details: ['The specified note does not exist']
        });
      }

      // Check if user can delete this note (access control)
      // This would depend on your business logic
      // For now, we'll allow deletion

      // Delete note
      const deleteResult = await storageService.deleteNote(noteId);

      if (!deleteResult) {
        return res.status(500).json({
          error: 'Delete failed',
          details: ['Failed to delete the note']
        });
      }

      // Invalidate caches
      await cacheService.delete(`note:${noteId}`);
      await cacheService.invalidateByTags([
        `agent:${note.agent_id}`,
        'notes:recent'
      ]);

      const responseTime = Date.now() - startTime;

      // Log note deletion
      console.log(`🗑️ Note deleted: ${noteId} by user ${user.userId}`);

      res.status(200).json({
        message: 'Note deleted successfully',
        data: {
          note_id: noteId,
          deleted_at: new Date().toISOString()
        },
        metadata: {
          response_time_ms: responseTime
        }
      });

    } catch (error) {
      console.error('❌ Delete note failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to delete note. Please try again later.']
      });
    }
  })
);

/**
 * Error handling middleware untuk notes routes
 */
router.use((error, req, res, next) => {
  console.error('❌ Notes route error:', error);

  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(detail => detail.message)
    });
  }

  // Handle rate limit errors
  if (error.status === 429) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      details: ['Too many requests. Please try again later.'],
      retry_after: error.retryAfter
    });
  }

  // Generic error
  res.status(500).json({
    error: 'Internal server error',
    details: ['An unexpected error occurred']
  });
});

export default router;