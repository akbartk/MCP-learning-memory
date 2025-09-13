/**
 * Knowledge Routes
 * 
 * Routes untuk knowledge management operations
 * Endpoints: /knowledge
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

// Apply authentication to all knowledge routes
router.use(authenticate);

// Validation schemas
const getKnowledgeSchema = Joi.object({
  domain: Joi.string().required()
    .messages({
      'any.required': 'Domain is required'
    }),
  min_confidence: Joi.number().min(0).max(1).default(0.7)
    .messages({
      'number.min': 'Min confidence must be at least 0',
      'number.max': 'Min confidence must not exceed 1'
    }),
  limit: Joi.number().integer().min(1).max(100).default(50)
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 100'
    }),
  version: Joi.number().integer().min(1).optional()
    .messages({
      'number.min': 'Version must be at least 1'
    })
});

/**
 * GET /knowledge
 * Get aggregated knowledge by domain
 */
router.get('/',
  rateLimitApi,
  validateRequest(getKnowledgeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        domain,
        min_confidence,
        limit,
        version
      } = req.query;

      const user = req.user;

      // Check if user has access to knowledge in this domain
      // This would depend on subscription tier and permissions
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('knowledge_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Knowledge access requires pro or enterprise subscription']
        });
      }

      // Try cache first
      const cacheKey = `knowledge:${domain}:${min_confidence}:${limit}:${version || 'latest'}`;
      const cachedResult = await cacheService.get(cacheKey);

      if (cachedResult) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Knowledge retrieved successfully',
          data: cachedResult,
          metadata: {
            response_time_ms: responseTime,
            cached: true,
            cache_age: await cacheService.getTTL(cacheKey)
          }
        });
      }

      // Get knowledge from storage
      const knowledgeResult = await storageService.getKnowledge(domain, parseFloat(min_confidence));

      // Filter by version if specified
      let filteredKnowledge = knowledgeResult.knowledge_items;
      if (version) {
        filteredKnowledge = filteredKnowledge.filter(item => item.version === parseInt(version));
      }

      // Apply limit
      filteredKnowledge = filteredKnowledge.slice(0, parseInt(limit));

      // Enrich with additional metadata
      const enrichedKnowledge = filteredKnowledge.map(item => ({
        ...item,
        accessed_by: user.userId,
        accessed_at: new Date().toISOString(),
        domain_verified: true
      }));

      const finalResult = {
        knowledge_items: enrichedKnowledge,
        domain,
        total_items: filteredKnowledge.length,
        min_confidence_applied: parseFloat(min_confidence),
        version_filter: version ? parseInt(version) : null,
        metadata: {
          domain_coverage: this.calculateDomainCoverage(enrichedKnowledge, domain),
          confidence_distribution: this.analyzeConfidenceDistribution(enrichedKnowledge),
          last_updated: this.getLastUpdated(enrichedKnowledge)
        }
      };

      // Cache result for 30 minutes (knowledge is relatively stable)
      await cacheService.setWithTags(
        cacheKey, 
        finalResult, 
        [`knowledge:${domain}`, 'knowledge:all'],
        1800
      );

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Knowledge retrieved successfully',
        data: finalResult,
        metadata: {
          response_time_ms: responseTime,
          cached: false,
          query_parameters: {
            domain,
            min_confidence: parseFloat(min_confidence),
            limit: parseInt(limit),
            version: version ? parseInt(version) : null
          }
        }
      });

    } catch (error) {
      console.error('❌ Get knowledge failed:', error);

      // Handle specific errors
      if (error.message.includes('Domain not found')) {
        return res.status(404).json({
          error: 'Domain not found',
          details: ['The specified knowledge domain does not exist']
        });
      }

      if (error.message.includes('Invalid confidence')) {
        return res.status(400).json({
          error: 'Invalid confidence value',
          details: ['Confidence must be between 0 and 1']
        });
      }

      // Generic error response
      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve knowledge. Please try again later.']
      });
    }
  })
);

/**
 * GET /knowledge/domains
 * Get list of available knowledge domains
 */
router.get('/domains',
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const user = req.user;

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('knowledge_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Knowledge access requires pro or enterprise subscription']
        });
      }

      // Try cache first
      const cacheKey = 'knowledge:domains:all';
      const cachedDomains = await cacheService.get(cacheKey);

      if (cachedDomains) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Knowledge domains retrieved successfully',
          data: cachedDomains,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get domains from storage
      const domains = await storageService.getKnowledgeDomains();

      // Enrich with statistics
      const enrichedDomains = await Promise.all(
        domains.map(async (domain) => {
          const stats = await this.getDomainStatistics(domain.name);
          return {
            ...domain,
            statistics: stats,
            last_accessed: new Date().toISOString()
          };
        })
      );

      const result = {
        domains: enrichedDomains,
        total_domains: enrichedDomains.length,
        access_level: userSubscription.tier,
        last_updated: new Date().toISOString()
      };

      // Cache for 1 hour (domains don't change frequently)
      await cacheService.setWithTags(
        cacheKey,
        result,
        ['knowledge:domains'],
        3600
      );

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Knowledge domains retrieved successfully',
        data: result,
        metadata: {
          response_time_ms: responseTime,
          cached: false
        }
      });

    } catch (error) {
      console.error('❌ Get knowledge domains failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve knowledge domains. Please try again later.']
      });
    }
  })
);

/**
 * GET /knowledge/:domain/summary
 * Get summary of knowledge in specific domain
 */
router.get('/:domain/summary',
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { domain } = req.params;
      const user = req.user;

      // Validate domain parameter
      if (!domain || domain.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid domain',
          details: ['Domain parameter must be provided and non-empty']
        });
      }

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('knowledge_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Knowledge access requires pro or enterprise subscription']
        });
      }

      // Try cache first
      const cacheKey = `knowledge:summary:${domain}`;
      const cachedSummary = await cacheService.get(cacheKey);

      if (cachedSummary) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Knowledge summary retrieved successfully',
          data: cachedSummary,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get knowledge summary from storage
      const summary = await storageService.getKnowledgeSummary(domain);

      if (!summary || summary.total_items === 0) {
        return res.status(404).json({
          error: 'Domain not found',
          details: [`No knowledge found for domain: ${domain}`]
        });
      }

      // Enrich summary with additional analytics
      const enrichedSummary = {
        ...summary,
        domain,
        analytics: {
          confidence_trends: await this.getConfidenceTrends(domain),
          knowledge_growth: await this.getKnowledgeGrowth(domain),
          popular_topics: await this.getPopularTopics(domain),
          recent_updates: await this.getRecentUpdates(domain)
        },
        recommendations: await this.getKnowledgeRecommendations(domain, user),
        access_info: {
          user_tier: userSubscription.tier,
          access_granted: true,
          accessed_by: user.userId,
          accessed_at: new Date().toISOString()
        }
      };

      // Cache for 15 minutes (summaries can change more frequently)
      await cacheService.setWithTags(
        cacheKey,
        enrichedSummary,
        [`knowledge:${domain}`, 'knowledge:summaries'],
        900
      );

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Knowledge summary retrieved successfully',
        data: enrichedSummary,
        metadata: {
          response_time_ms: responseTime,
          cached: false,
          domain
        }
      });

    } catch (error) {
      console.error('❌ Get knowledge summary failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve knowledge summary. Please try again later.']
      });
    }
  })
);

/**
 * POST /knowledge/search
 * Search across knowledge domains
 */
router.post('/search',
  rateLimitApi,
  validateRequest(Joi.object({
    query: Joi.string().required()
      .messages({
        'any.required': 'Search query is required'
      }),
    domains: Joi.array().items(Joi.string()).optional(),
    min_confidence: Joi.number().min(0).max(1).default(0.6),
    limit: Joi.number().integer().min(1).max(50).default(20)
  })),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { query, domains, min_confidence, limit } = req.body;
      const user = req.user;

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('knowledge_search')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Knowledge search requires pro or enterprise subscription']
        });
      }

      // Execute knowledge search
      const searchResult = await storageService.searchKnowledge({
        query,
        domains: domains || [],
        minConfidence: parseFloat(min_confidence),
        limit: parseInt(limit)
      });

      // Add search analytics
      const analyticsData = {
        search_terms: this.extractSearchTerms(query),
        domains_searched: domains || ['all'],
        results_relevance: this.analyzeResultsRelevance(searchResult.items),
        search_quality_score: this.calculateSearchQuality(query, searchResult.items)
      };

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Knowledge search completed successfully',
        data: {
          ...searchResult,
          analytics: analyticsData,
          search_metadata: {
            query,
            domains_searched: domains || ['all'],
            min_confidence_applied: parseFloat(min_confidence),
            total_results: searchResult.items.length,
            search_time_ms: responseTime
          }
        },
        metadata: {
          response_time_ms: responseTime,
          user_id: user.userId,
          search_type: 'knowledge'
        }
      });

    } catch (error) {
      console.error('❌ Knowledge search failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Knowledge search failed. Please try again later.']
      });
    }
  })
);

// Helper methods (these would be implemented as class methods in real implementation)

router.calculateDomainCoverage = (knowledgeItems, domain) => {
  // Calculate how well the domain is covered
  return {
    coverage_percentage: Math.min(100, knowledgeItems.length * 2), // Simplified calculation
    areas_covered: knowledgeItems.length,
    estimated_completeness: knowledgeItems.length > 10 ? 'high' : 'medium'
  };
};

router.analyzeConfidenceDistribution = (knowledgeItems) => {
  const confidences = knowledgeItems.map(item => item.confidence_score);
  return {
    average: confidences.reduce((a, b) => a + b, 0) / confidences.length,
    min: Math.min(...confidences),
    max: Math.max(...confidences),
    high_confidence_count: confidences.filter(c => c >= 0.8).length
  };
};

router.getLastUpdated = (knowledgeItems) => {
  // Return the most recent update timestamp
  return new Date().toISOString(); // Simplified
};

router.getDomainStatistics = async (domainName) => {
  // Get statistics for a specific domain
  return {
    total_items: Math.floor(Math.random() * 100) + 10, // Mock data
    average_confidence: 0.75 + Math.random() * 0.2,
    last_updated: new Date().toISOString(),
    active_contributors: Math.floor(Math.random() * 10) + 1
  };
};

router.getConfidenceTrends = async (domain) => {
  // Mock confidence trends
  return {
    trend: 'increasing',
    change_percentage: 5.2,
    period: '30_days'
  };
};

router.getKnowledgeGrowth = async (domain) => {
  // Mock growth data
  return {
    items_added_last_month: Math.floor(Math.random() * 20) + 5,
    growth_rate: '12%',
    trend: 'stable'
  };
};

router.getPopularTopics = async (domain) => {
  // Mock popular topics
  return [
    { topic: 'API Development', mentions: 45 },
    { topic: 'Database Design', mentions: 32 },
    { topic: 'Error Handling', mentions: 28 }
  ];
};

router.getRecentUpdates = async (domain) => {
  // Mock recent updates
  return [
    {
      id: 'update-1',
      title: 'Updated API guidelines',
      updated_at: new Date().toISOString(),
      confidence_change: 0.05
    }
  ];
};

router.getKnowledgeRecommendations = async (domain, user) => {
  // Generate recommendations based on user and domain
  return [
    {
      type: 'explore',
      title: 'Explore related domains',
      description: 'Based on your access pattern, you might be interested in these domains',
      items: ['development', 'architecture', 'testing']
    }
  ];
};

router.extractSearchTerms = (query) => {
  return query.toLowerCase().split(/\W+/).filter(term => term.length > 2);
};

router.analyzeResultsRelevance = (items) => {
  const scores = items.map(item => item.confidence_score);
  return {
    average_relevance: scores.reduce((a, b) => a + b, 0) / scores.length,
    highly_relevant_count: scores.filter(s => s >= 0.8).length
  };
};

router.calculateSearchQuality = (query, items) => {
  // Simple quality score based on query length and results
  const queryQuality = Math.min(1, query.length / 50);
  const resultsQuality = Math.min(1, items.length / 10);
  return (queryQuality + resultsQuality) / 2;
};

/**
 * Error handling middleware untuk knowledge routes
 */
router.use((error, req, res, next) => {
  console.error('❌ Knowledge route error:', error);

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