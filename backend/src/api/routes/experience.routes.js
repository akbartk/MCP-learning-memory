/**
 * Experience Routes
 * 
 * Routes untuk learning experiences operations
 * Endpoints: /experiences
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

// Apply authentication to all experience routes
router.use(authenticate);

// Validation schemas
const getExperiencesSchema = Joi.object({
  project_id: Joi.string().optional(),
  applicable_domain: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  sort_by: Joi.string().valid('created_at', 'relevance', 'impact').default('created_at'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc')
});

/**
 * GET /experiences
 * Get learning experiences with filtering
 */
router.get('/',
  rateLimitApi,
  validateRequest(getExperiencesSchema, 'query'),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        project_id,
        applicable_domain,
        limit,
        offset,
        sort_by,
        sort_order
      } = req.query;

      const user = req.user;

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('experience_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Experience access requires pro or enterprise subscription']
        });
      }

      // Build cache key
      const cacheKey = `experiences:${project_id || 'all'}:${applicable_domain || 'all'}:${limit}:${offset}:${sort_by}:${sort_order}`;
      
      // Try cache first
      const cachedResult = await cacheService.get(cacheKey);
      if (cachedResult) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Experiences retrieved successfully',
          data: cachedResult,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Build filters
      const filters = {};
      if (project_id) filters.projectId = project_id;
      if (applicable_domain) filters.applicableDomain = applicable_domain;

      // Get experiences from storage
      const experiencesResult = await storageService.getExperiences(filters);

      // Apply sorting
      let sortedExperiences = experiencesResult.experiences;
      sortedExperiences.sort((a, b) => {
        let aVal = a[sort_by] || a.created_at;
        let bVal = b[sort_by] || b.created_at;

        if (sort_by === 'created_at') {
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
      const paginatedExperiences = sortedExperiences.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );

      // Enrich with additional metadata
      const enrichedExperiences = paginatedExperiences.map(experience => ({
        ...experience,
        accessed_by: user.userId,
        accessed_at: new Date().toISOString(),
        relevance_score: this.calculateRelevanceScore(experience, user),
        impact_metrics: this.calculateImpactMetrics(experience)
      }));

      const result = {
        experiences: enrichedExperiences,
        pagination: {
          total: sortedExperiences.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: (parseInt(offset) + parseInt(limit)) < sortedExperiences.length
        },
        filters_applied: {
          project_id: project_id || null,
          applicable_domain: applicable_domain || null,
          sort_by,
          sort_order
        },
        metadata: {
          total_experiences: sortedExperiences.length,
          unique_projects: this.countUniqueProjects(sortedExperiences),
          unique_domains: this.countUniqueDomains(sortedExperiences),
          average_impact: this.calculateAverageImpact(enrichedExperiences)
        }
      };

      // Cache for 20 minutes
      await cacheService.setWithTags(
        cacheKey,
        result,
        ['experiences:all', `experiences:${applicable_domain || 'global'}`],
        1200
      );

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Experiences retrieved successfully',
        data: result,
        metadata: {
          response_time_ms: responseTime,
          cached: false,
          user_tier: userSubscription.tier
        }
      });

    } catch (error) {
      console.error('❌ Get experiences failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve experiences. Please try again later.']
      });
    }
  })
);

/**
 * GET /experiences/:experienceId
 * Get specific experience by ID
 */
router.get('/:experienceId',
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { experienceId } = req.params;
      const user = req.user;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(experienceId)) {
        return res.status(400).json({
          error: 'Invalid experience ID',
          details: ['Experience ID must be a valid UUID']
        });
      }

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('experience_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Experience access requires pro or enterprise subscription']
        });
      }

      // Try cache first
      const cacheKey = `experience:${experienceId}`;
      const cachedExperience = await cacheService.get(cacheKey);

      if (cachedExperience) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Experience retrieved successfully',
          data: cachedExperience,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get experience from storage
      const experience = await storageService.getExperienceById(experienceId);

      if (!experience) {
        return res.status(404).json({
          error: 'Experience not found',
          details: ['The specified experience does not exist']
        });
      }

      // Enrich with detailed analytics
      const enrichedExperience = {
        ...experience,
        analytics: {
          impact_score: this.calculateDetailedImpactScore(experience),
          applicability: this.analyzeApplicability(experience),
          similar_experiences: await this.findSimilarExperiences(experience),
          usage_recommendations: this.generateUsageRecommendations(experience, user)
        },
        access_info: {
          accessed_by: user.userId,
          accessed_at: new Date().toISOString(),
          access_count: await this.incrementAccessCount(experienceId)
        }
      };

      // Cache for 30 minutes
      await cacheService.set(cacheKey, enrichedExperience, 1800);

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Experience retrieved successfully',
        data: enrichedExperience,
        metadata: {
          response_time_ms: responseTime,
          cached: false
        }
      });

    } catch (error) {
      console.error('❌ Get experience failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve experience. Please try again later.']
      });
    }
  })
);

/**
 * GET /experiences/domains
 * Get list of available domains with experience counts
 */
router.get('/domains',
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const user = req.user;

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('experience_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Experience access requires pro or enterprise subscription']
        });
      }

      // Try cache first
      const cacheKey = 'experiences:domains:all';
      const cachedDomains = await cacheService.get(cacheKey);

      if (cachedDomains) {
        const responseTime = Date.now() - startTime;
        return res.status(200).json({
          message: 'Experience domains retrieved successfully',
          data: cachedDomains,
          metadata: {
            response_time_ms: responseTime,
            cached: true
          }
        });
      }

      // Get domains from storage
      const domains = await storageService.getExperienceDomains();

      // Enrich with statistics
      const enrichedDomains = await Promise.all(
        domains.map(async (domain) => {
          const stats = await this.getDomainExperienceStats(domain.name);
          return {
            ...domain,
            statistics: stats,
            trending: this.isDomainTrending(stats),
            recommendations: this.getDomainRecommendations(domain, user)
          };
        })
      );

      const result = {
        domains: enrichedDomains,
        total_domains: enrichedDomains.length,
        user_access_level: userSubscription.tier,
        summary: {
          total_experiences: enrichedDomains.reduce((sum, d) => sum + d.statistics.experience_count, 0),
          most_active_domain: enrichedDomains.reduce((max, d) => 
            d.statistics.experience_count > max.statistics.experience_count ? d : max
          ),
          trending_domains: enrichedDomains.filter(d => d.trending).length
        }
      };

      // Cache for 1 hour
      await cacheService.setWithTags(
        cacheKey,
        result,
        ['experiences:domains'],
        3600
      );

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Experience domains retrieved successfully',
        data: result,
        metadata: {
          response_time_ms: responseTime,
          cached: false
        }
      });

    } catch (error) {
      console.error('❌ Get experience domains failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve experience domains. Please try again later.']
      });
    }
  })
);

/**
 * POST /experiences/recommendations
 * Get personalized experience recommendations
 */
router.post('/recommendations',
  rateLimitApi,
  validateRequest(Joi.object({
    context: Joi.object({
      current_project: Joi.string().optional(),
      technologies: Joi.array().items(Joi.string()).optional(),
      challenges: Joi.array().items(Joi.string()).optional(),
      goals: Joi.array().items(Joi.string()).optional()
    }).optional(),
    max_results: Joi.number().integer().min(1).max(20).default(10)
  })),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { context = {}, max_results } = req.body;
      const user = req.user;

      // Check feature access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('experience_recommendations')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Experience recommendations require enterprise subscription']
        });
      }

      // Get personalized recommendations
      const recommendations = await storageService.getPersonalizedExperiences({
        userId: user.userId,
        context,
        maxResults: parseInt(max_results)
      });

      // Analyze recommendation quality
      const qualityMetrics = {
        relevance_scores: recommendations.map(r => r.relevance_score),
        diversity_score: this.calculateDiversityScore(recommendations),
        coverage_score: this.calculateCoverageScore(recommendations, context),
        personalization_strength: this.calculatePersonalizationStrength(recommendations, user)
      };

      const result = {
        recommendations,
        recommendation_metadata: {
          algorithm: 'collaborative_filtering_with_content',
          context_used: context,
          personalization_factors: this.getPersonalizationFactors(user),
          quality_metrics: qualityMetrics
        },
        user_insights: {
          experience_patterns: this.analyzeUserExperiencePatterns(user),
          learning_preferences: this.getUserLearningPreferences(user),
          skill_gaps: this.identifySkillGaps(user, recommendations)
        }
      };

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Experience recommendations generated successfully',
        data: result,
        metadata: {
          response_time_ms: responseTime,
          recommendation_count: recommendations.length,
          user_id: user.userId
        }
      });

    } catch (error) {
      console.error('❌ Get experience recommendations failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to generate experience recommendations. Please try again later.']
      });
    }
  })
);

// Helper methods
router.calculateRelevanceScore = (experience, user) => {
  // Simple relevance calculation based on user profile
  return 0.5 + Math.random() * 0.5; // Mock implementation
};

router.calculateImpactMetrics = (experience) => {
  return {
    learning_impact: Math.random() * 10,
    applicability_score: Math.random() * 10,
    difficulty_level: Math.floor(Math.random() * 5) + 1
  };
};

router.countUniqueProjects = (experiences) => {
  const projects = new Set(experiences.map(e => e.project_id).filter(Boolean));
  return projects.size;
};

router.countUniqueDomains = (experiences) => {
  const domains = new Set(experiences.map(e => e.applicable_domain).filter(Boolean));
  return domains.size;
};

router.calculateAverageImpact = (experiences) => {
  if (experiences.length === 0) return 0;
  const totalImpact = experiences.reduce((sum, e) => sum + (e.impact_metrics?.learning_impact || 0), 0);
  return totalImpact / experiences.length;
};

router.calculateDetailedImpactScore = (experience) => {
  return {
    technical_learning: Math.random() * 10,
    process_improvement: Math.random() * 10,
    team_collaboration: Math.random() * 10,
    overall_score: Math.random() * 10
  };
};

router.analyzeApplicability = (experience) => {
  return {
    applicable_domains: ['development', 'testing', 'deployment'],
    technology_stack: ['javascript', 'node.js', 'react'],
    team_size_suitability: 'small-to-medium',
    complexity_level: 'intermediate'
  };
};

router.findSimilarExperiences = async (experience) => {
  // Mock similar experiences
  return [
    { id: 'exp-1', title: 'Similar API Development Experience', similarity: 0.85 },
    { id: 'exp-2', title: 'Related Database Optimization', similarity: 0.72 }
  ];
};

router.generateUsageRecommendations = (experience, user) => {
  return [
    {
      scenario: 'API Development Projects',
      applicability: 'high',
      adaptation_notes: 'Consider your team size and timeline'
    }
  ];
};

router.incrementAccessCount = async (experienceId) => {
  // Increment access counter
  const cacheService = new CacheService();
  return await cacheService.increment(`experience:access:${experienceId}`, 1, 86400);
};

/**
 * Error handling middleware untuk experience routes
 */
router.use((error, req, res, next) => {
  console.error('❌ Experience route error:', error);

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