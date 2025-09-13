/**
 * Monitoring Routes
 * 
 * Routes untuk system monitoring dan health checks
 * Endpoints: /metrics, /health
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { Router } from 'express';
import Joi from 'joi';
import sharedServices from '../../services/shared-services.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { rateLimitApi } from '../middleware/rate-limit.middleware.js';
import { asyncHandler } from '../middleware/async-handler.middleware.js';

const router = Router();

// Validation schemas
const metricsSchema = Joi.object({
  period: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
  include_details: Joi.boolean().default(false),
  component: Joi.string().valid('api', 'storage', 'search', 'cache', 'backup').optional()
});

/**
 * GET /health
 * System health check (public endpoint)
 */
router.get('/health',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      // Perform health checks for all components
      const healthChecks = await Promise.allSettled([
        checkApiHealth(),
        checkStorageHealth(),
        checkCacheHealth(),
        checkSearchHealth(),
        checkBackupHealth()
      ]);

      // Process results
      const services = {
        api: healthChecks[0].status === 'fulfilled' ? healthChecks[0].value : false,
        redis: healthChecks[1].status === 'fulfilled' ? healthChecks[1].value.redis : false,
        scylladb: healthChecks[1].status === 'fulfilled' ? healthChecks[1].value.scylla : false,
        elasticsearch: healthChecks[1].status === 'fulfilled' ? healthChecks[1].value.elasticsearch : false
      };

      // Determine overall status
      const allHealthy = Object.values(services).every(status => status === true);
      const someHealthy = Object.values(services).some(status => status === true);
      
      let overallStatus;
      if (allHealthy) {
        overallStatus = 'healthy';
      } else if (someHealthy) {
        overallStatus = 'degraded';
      } else {
        overallStatus = 'unhealthy';
      }

      const responseTime = Date.now() - startTime;

      // Set appropriate HTTP status
      const httpStatus = overallStatus === 'healthy' ? 200 : 
                        overallStatus === 'degraded' ? 200 : 503;

      res.status(httpStatus).json({
        status: overallStatus,
        services,
        timestamp: new Date().toISOString(),
        response_time_ms: responseTime,
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      });

    } catch (error) {
      console.error('❌ Health check failed:', error);

      res.status(503).json({
        status: 'unhealthy',
        services: {
          api: false,
          redis: false,
          scylladb: false,
          elasticsearch: false
        },
        timestamp: new Date().toISOString(),
        error: 'Health check system failure'
      });
    }
  })
);

/**
 * GET /metrics
 * Get system metrics (protected endpoint)
 */
router.get('/metrics',
  authenticate,
  rateLimitApi,
  validateRequest(metricsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { period, include_details, component } = req.query;
      const user = req.user;

      // Check if user has monitoring access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('monitoring_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Monitoring access requires pro or enterprise subscription']
        });
      }

      // Get metrics based on component filter
      let metrics = {};

      if (!component || component === 'api') {
        metrics.api = await getApiMetrics(period);
      }

      if (!component || component === 'storage') {
        metrics.storage = await getStorageMetrics(period);
      }

      if (!component || component === 'search') {
        metrics.search = await getSearchMetrics(period);
      }

      if (!component || component === 'cache') {
        metrics.cache = await getCacheMetrics(period);
      }

      if (!component || component === 'backup') {
        metrics.backup = await getBackupMetrics(period);
      }

      // Add system-wide metrics
      metrics.system = await getSystemMetrics(period);

      // Add detailed metrics if requested
      if (include_details) {
        metrics.details = {
          performance_trends: await getPerformanceTrends(period),
          error_analysis: await getErrorAnalysis(period),
          usage_patterns: await getUsagePatterns(period),
          capacity_planning: await getCapacityMetrics()
        };
      }

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Metrics retrieved successfully',
        data: {
          period,
          metrics,
          metadata: {
            generated_at: new Date().toISOString(),
            data_freshness: getDataFreshness(period),
            user_access_level: userSubscription.tier,
            response_time_ms: responseTime
          }
        }
      });

    } catch (error) {
      console.error('❌ Get metrics failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve metrics. Please try again later.']
      });
    }
  })
);

/**
 * GET /metrics/alerts
 * Get system alerts and warnings
 */
router.get('/metrics/alerts',
  authenticate,
  rateLimitApi,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const user = req.user;

      // Check monitoring access
      const userSubscription = user.subscription || {};
      if (!userSubscription.features?.includes('monitoring_access')) {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Monitoring access requires pro or enterprise subscription']
        });
      }

      // Get active alerts
      const alerts = await getActiveAlerts();
      const warnings = await getActiveWarnings();
      const recommendations = await getSystemRecommendations();

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Alerts retrieved successfully',
        data: {
          alerts: {
            critical: alerts.filter(a => a.severity === 'critical'),
            warning: alerts.filter(a => a.severity === 'warning'),
            info: alerts.filter(a => a.severity === 'info')
          },
          warnings,
          recommendations,
          summary: {
            total_alerts: alerts.length,
            critical_count: alerts.filter(a => a.severity === 'critical').length,
            last_alert: alerts.length > 0 ? alerts[0].timestamp : null,
            system_health_score: calculateHealthScore(alerts, warnings)
          }
        },
        metadata: {
          response_time_ms: responseTime,
          checked_at: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Get alerts failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve alerts. Please try again later.']
      });
    }
  })
);

/**
 * GET /metrics/performance
 * Get detailed performance metrics
 */
router.get('/metrics/performance',
  authenticate,
  rateLimitApi,
  validateRequest(Joi.object({
    hours: Joi.number().integer().min(1).max(168).default(24), // Max 1 week
    granularity: Joi.string().valid('minute', 'hour', 'day').default('hour')
  }), 'query'),
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const { hours, granularity } = req.query;
      const user = req.user;

      // Check enterprise access for detailed performance metrics
      const userSubscription = user.subscription || {};
      if (userSubscription.tier !== 'enterprise') {
        return res.status(403).json({
          error: 'Feature not available',
          details: ['Detailed performance metrics require enterprise subscription']
        });
      }

      // Get performance data
      const performanceData = await getDetailedPerformanceMetrics(hours, granularity);

      const responseTime = Date.now() - startTime;

      res.status(200).json({
        message: 'Performance metrics retrieved successfully',
        data: {
          ...performanceData,
          analysis: {
            trends: analyzePerformanceTrends(performanceData),
            bottlenecks: identifyBottlenecks(performanceData),
            optimization_suggestions: generateOptimizationSuggestions(performanceData)
          }
        },
        metadata: {
          period_hours: parseInt(hours),
          granularity,
          data_points: performanceData.timestamps?.length || 0,
          response_time_ms: responseTime
        }
      });

    } catch (error) {
      console.error('❌ Get performance metrics failed:', error);

      res.status(500).json({
        error: 'Internal server error',
        details: ['Failed to retrieve performance metrics. Please try again later.']
      });
    }
  })
);

// Helper methods for health checks

const checkApiHealth = async () => {
  try {
    // Check API responsiveness
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    return {
      status: true,
      uptime_seconds: uptime,
      memory_usage_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      memory_total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024)
    };
  } catch (error) {
    return false;
  }
};

const checkStorageHealth = async () => {
  try {
    const storageService = sharedServices.getStorageService();
    return await storageService.getHealthStatus();
  } catch (error) {
    return { redis: false, scylla: false, elasticsearch: false };
  }
};

const checkCacheHealth = async () => {
  try {
    const cacheService = sharedServices.getCacheService();
    return await cacheService.healthCheck();
  } catch (error) {
    return false;
  }
};

const checkSearchHealth = async () => {
  try {
    // Simple search health check
    const searchService = sharedServices.getSearchService();
    const searchStats = await searchService.getStatistics();
    return searchStats ? true : false;
  } catch (error) {
    return false;
  }
};

const checkBackupHealth = async () => {
  try {
    const backupService = sharedServices.getBackupService();
    const backupStats = await backupService.getBackupStatistics();
    return backupStats ? true : false;
  } catch (error) {
    return false;
  }
};

// Helper methods for metrics

const getApiMetrics = async (period) => {
  // Mock API metrics - in production would come from monitoring system
  return {
    requests_per_second: 45.2 + Math.random() * 10,
    average_response_time_ms: 150 + Math.random() * 50,
    error_rate_percent: Math.random() * 2,
    active_connections: Math.floor(Math.random() * 100) + 50,
    throughput_mb_per_sec: 2.5 + Math.random() * 1.5
  };
};

const getStorageMetrics = async (period) => {
  try {
    const storageStats = await storageService.getStatistics();
    return {
      ...storageStats,
      queries_per_second: 25 + Math.random() * 15,
      cache_hit_rate: 0.85 + Math.random() * 0.1,
      storage_used_gb: 12.5 + Math.random() * 5,
      connection_pool_usage: 0.6 + Math.random() * 0.2
    };
  } catch (error) {
    return { error: 'Storage metrics unavailable' };
  }
};

const getSearchMetrics = async (period) => {
  try {
    const searchStats = await searchService.getStatistics();
    return {
      ...searchStats,
      searches_per_minute: 15 + Math.random() * 10,
      index_size_mb: 256 + Math.random() * 100,
      search_latency_p95_ms: 200 + Math.random() * 100
    };
  } catch (error) {
    return { error: 'Search metrics unavailable' };
  }
};

const getCacheMetrics = async (period) => {
  try {
    const cacheStats = await cacheService.getStatistics();
    return cacheStats;
  } catch (error) {
    return { error: 'Cache metrics unavailable' };
  }
};

const getBackupMetrics = async (period) => {
  try {
    const backupStats = await backupService.getBackupStatistics();
    return {
      ...backupStats,
      last_backup_age_hours: Math.random() * 24,
      backup_success_rate: 0.95 + Math.random() * 0.05,
      average_backup_duration_minutes: 5 + Math.random() * 10
    };
  } catch (error) {
    return { error: 'Backup metrics unavailable' };
  }
};

const getSystemMetrics = async (period) => {
  const cpuUsage = process.cpuUsage();
  const memoryUsage = process.memoryUsage();
  
  return {
    cpu_usage_percent: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to percentage (simplified)
    memory_usage_percent: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
    uptime_hours: process.uptime() / 3600,
    node_version: process.version,
    platform: process.platform,
    load_average: require('os').loadavg()
  };
};

const getPerformanceTrends = async (period) => {
  // Mock performance trends
  return {
    response_time_trend: 'improving',
    throughput_trend: 'stable',
    error_rate_trend: 'decreasing',
    resource_usage_trend: 'increasing'
  };
};

const getErrorAnalysis = async (period) => {
  // Mock error analysis
  return {
    total_errors: Math.floor(Math.random() * 50),
    error_types: {
      '4xx': Math.floor(Math.random() * 30),
      '5xx': Math.floor(Math.random() * 20),
      'timeout': Math.floor(Math.random() * 10)
    },
    top_error_endpoints: [
      { endpoint: '/api/v1/search', errors: 5 },
      { endpoint: '/api/v1/notes', errors: 3 }
    ]
  };
};

const getUsagePatterns = async (period) => {
  // Mock usage patterns
  return {
    peak_hours: ['09:00', '14:00', '16:00'],
    busiest_endpoints: [
      { endpoint: '/api/v1/notes', requests: 1250 },
      { endpoint: '/api/v1/search', requests: 890 }
    ],
    user_distribution: {
      basic: 60,
      pro: 35,
      enterprise: 5
    }
  };
};

const getCapacityMetrics = async () => {
  return {
    current_capacity_percent: 65 + Math.random() * 20,
    projected_capacity_30_days: 85 + Math.random() * 10,
    recommended_scaling_action: 'monitor',
    bottleneck_components: ['elasticsearch', 'scylladb']
  };
};

const getActiveAlerts = async () => {
  // Mock active alerts
  const alerts = [];
  
  if (Math.random() > 0.8) {
    alerts.push({
      id: 'alert-1',
      severity: 'warning',
      component: 'cache',
      message: 'Cache hit rate below 80%',
      timestamp: new Date().toISOString(),
      threshold: 0.8,
      current_value: 0.75
    });
  }
  
  if (Math.random() > 0.9) {
    alerts.push({
      id: 'alert-2',
      severity: 'critical',
      component: 'storage',
      message: 'Database connection pool exhausted',
      timestamp: new Date().toISOString(),
      threshold: 100,
      current_value: 98
    });
  }
  
  return alerts;
};

const getActiveWarnings = async () => {
  return [
    {
      id: 'warn-1',
      message: 'Elasticsearch disk usage approaching 80%',
      component: 'search',
      timestamp: new Date().toISOString()
    }
  ];
};

const getSystemRecommendations = async () => {
  return [
    {
      type: 'performance',
      priority: 'medium',
      title: 'Consider adding Redis memory',
      description: 'Cache performance could be improved with additional memory allocation'
    },
    {
      type: 'backup',
      priority: 'low',
      title: 'Archive old backups',
      description: 'Consider archiving backups older than 6 months to free up storage'
    }
  ];
};

const calculateHealthScore = (alerts, warnings) => {
  const criticalPenalty = alerts.filter(a => a.severity === 'critical').length * 20;
  const warningPenalty = alerts.filter(a => a.severity === 'warning').length * 10;
  const infoPenalty = warnings.length * 5;
  
  return Math.max(0, 100 - criticalPenalty - warningPenalty - infoPenalty);
};

const getDataFreshness = (period) => {
  const freshnessMap = {
    hour: 'real-time',
    day: '5-minute-delay',
    week: '1-hour-delay',
    month: '6-hour-delay'
  };
  return freshnessMap[period] || 'unknown';
};

const getDetailedPerformanceMetrics = async (hours, granularity) => {
  // Mock detailed performance metrics
  const dataPoints = Math.floor(hours * (granularity === 'minute' ? 60 : granularity === 'hour' ? 1 : 1/24));
  const timestamps = [];
  const values = [];

  for (let i = 0; i < dataPoints; i++) {
    timestamps.push(new Date(Date.now() - (i * 3600000)).toISOString());
    values.push({
      response_time_ms: 100 + Math.random() * 200,
      requests_per_second: 40 + Math.random() * 20,
      error_rate: Math.random() * 2,
      cpu_usage: 30 + Math.random() * 40,
      memory_usage: 40 + Math.random() * 30
    });
  }

  return {
    timestamps,
    values,
    aggregates: {
      avg_response_time: 150,
      p95_response_time: 280,
      p99_response_time: 350,
      total_requests: dataPoints * 3600 * 50,
      total_errors: Math.floor(dataPoints * 3600 * 0.5)
    }
  };
};

const analyzePerformanceTrends = (data) => {
  return {
    response_time: 'stable',
    throughput: 'increasing',
    error_rate: 'decreasing',
    resource_usage: 'optimal'
  };
};

const identifyBottlenecks = (data) => {
  return [
    {
      component: 'database_connections',
      severity: 'medium',
      impact: 'Increased latency during peak hours',
      recommendation: 'Increase connection pool size'
    }
  ];
};

const generateOptimizationSuggestions = (data) => {
  return [
    'Enable query caching for frequently accessed data',
    'Implement connection pooling for ScyllaDB',
    'Consider adding read replicas for high-traffic endpoints'
  ];
};

/**
 * Error handling middleware untuk monitoring routes
 */
router.use((error, req, res, next) => {
  console.error('❌ Monitoring route error:', error);

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