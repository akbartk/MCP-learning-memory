/**
 * Application Configuration
 * 
 * Central configuration untuk MCP Server application
 * Environment variables dan application settings
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Application Information
 */
export const appInfo = {
  name: process.env.APP_NAME || 'MCP Server Learning-AI + Memory',
  version: process.env.APP_VERSION || '1.0.0',
  description: process.env.APP_DESCRIPTION || 'External brain for AI Agents - stores and retrieves learning experiences',
  author: 'MCP Server Team',
  license: 'MIT',
  homepage: process.env.APP_HOMEPAGE || 'https://github.com/mcp-server/learning-memory',
  repository: process.env.APP_REPOSITORY || 'https://github.com/mcp-server/learning-memory.git',
  build: {
    timestamp: new Date().toISOString(),
    commit: process.env.GIT_COMMIT || 'unknown',
    branch: process.env.GIT_BRANCH || 'unknown'
  }
};

/**
 * Server Configuration
 */
export const serverConfig = {
  // Basic server settings
  port: parseInt(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  environment: process.env.NODE_ENV || 'development',
  
  // API settings
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  apiVersion: process.env.API_VERSION || 'v1',
  
  // CORS settings
  cors: {
    origin: process.env.CORS_ORIGIN ? 
      process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) : 
      ['http://localhost:3000', 'http://localhost:3001'],
    credentials: process.env.CORS_CREDENTIALS === 'true',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Response-Time', 'X-Cache-Hit', 'X-RateLimit-Limit', 'X-RateLimit-Remaining']
  },
  
  // Request limits
  limits: {
    bodySize: process.env.MAX_BODY_SIZE || '10mb',
    parameterLimit: parseInt(process.env.MAX_PARAMETER_LIMIT) || 100,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000,
    headerTimeout: parseInt(process.env.HEADER_TIMEOUT) || 60000,
    keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT) || 5000
  },
  
  // Security settings
  security: {
    helmet: {
      contentSecurityPolicy: process.env.CSP_ENABLED !== 'false',
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      hsts: {
        maxAge: parseInt(process.env.HSTS_MAX_AGE) || 31536000,
        includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false'
      }
    },
    trustProxy: process.env.TRUST_PROXY === 'true',
    rateLimiting: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
      skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESS === 'true',
      skipFailedRequests: process.env.RATE_LIMIT_SKIP_FAILED === 'true'
    }
  },
  
  // SSL/TLS settings
  ssl: process.env.SSL_ENABLED === 'true' ? {
    key: process.env.SSL_KEY_PATH,
    cert: process.env.SSL_CERT_PATH,
    ca: process.env.SSL_CA_PATH,
    passphrase: process.env.SSL_PASSPHRASE
  } : null
};

/**
 * Authentication Configuration
 */
export const authConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    issuer: process.env.JWT_ISSUER || 'mcp-server',
    audience: process.env.JWT_AUDIENCE || 'mcp-client',
    accessTokenExpiry: process.env.JWT_EXPIRES_IN || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    clockTolerance: parseInt(process.env.JWT_CLOCK_TOLERANCE) || 60 // seconds
  },
  
  // API Key settings
  apiKey: {
    header: process.env.API_KEY_HEADER || 'X-API-Key',
    prefix: process.env.API_KEY_PREFIX || 'mcp_',
    length: parseInt(process.env.API_KEY_LENGTH) || 32
  },
  
  // Session settings
  session: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5,
    defaultTimeout: parseInt(process.env.SESSION_TIMEOUT) || 24 * 60 * 60 * 1000, // 24 hours
    cleanupInterval: parseInt(process.env.SESSION_CLEANUP_INTERVAL) || 60 * 60 * 1000 // 1 hour
  },
  
  // Password requirements
  password: {
    minLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
    requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
    requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
    requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false',
    requireSpecialChars: process.env.PASSWORD_REQUIRE_SPECIAL !== 'false',
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12
  }
};

/**
 * Cache Configuration
 */
export const cacheConfig = {
  // Default TTL values (in seconds)
  defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 3600, // 1 hour
  shortTTL: parseInt(process.env.CACHE_SHORT_TTL) || 300,      // 5 minutes
  longTTL: parseInt(process.env.CACHE_LONG_TTL) || 86400,     // 24 hours
  
  // Cache key configuration
  keyPrefix: process.env.CACHE_KEY_PREFIX || 'mcp',
  maxKeyLength: parseInt(process.env.CACHE_MAX_KEY_LENGTH) || 250,
  
  // Value configuration
  maxValueSize: parseInt(process.env.CACHE_MAX_VALUE_SIZE) || 1024 * 1024, // 1MB
  enableCompression: process.env.CACHE_ENABLE_COMPRESSION === 'true',
  compressionThreshold: parseInt(process.env.CACHE_COMPRESSION_THRESHOLD) || 1024, // 1KB
  
  // Performance settings
  enableMetrics: process.env.CACHE_ENABLE_METRICS !== 'false',
  enableAnalytics: process.env.CACHE_ENABLE_ANALYTICS === 'true'
};

/**
 * Search Configuration
 */
export const searchConfig = {
  // Default search settings
  defaultLimit: parseInt(process.env.SEARCH_DEFAULT_LIMIT) || 10,
  maxLimit: parseInt(process.env.SEARCH_MAX_LIMIT) || 100,
  defaultRelevance: parseFloat(process.env.SEARCH_DEFAULT_RELEVANCE) || 0.5,
  
  // Search performance
  timeout: parseInt(process.env.SEARCH_TIMEOUT) || 10000, // 10 seconds
  enableHighlight: process.env.SEARCH_ENABLE_HIGHLIGHT !== 'false',
  highlightFragmentSize: parseInt(process.env.SEARCH_HIGHLIGHT_FRAGMENT_SIZE) || 150,
  
  // Search analytics
  enableAnalytics: process.env.SEARCH_ENABLE_ANALYTICS !== 'false',
  enableQueryLogging: process.env.SEARCH_ENABLE_QUERY_LOGGING === 'true',
  
  // Search caching
  enableCache: process.env.SEARCH_ENABLE_CACHE !== 'false',
  cacheTTL: parseInt(process.env.SEARCH_CACHE_TTL) || 300, // 5 minutes
  
  // Semantic search
  semantic: {
    enabled: process.env.SEMANTIC_SEARCH_ENABLED === 'true',
    modelPath: process.env.SEMANTIC_MODEL_PATH || null,
    vectorDimensions: parseInt(process.env.SEMANTIC_VECTOR_DIMENSIONS) || 384,
    similarityThreshold: parseFloat(process.env.SEMANTIC_SIMILARITY_THRESHOLD) || 0.7
  }
};

/**
 * Backup Configuration
 */
export const backupConfig = {
  // Backup storage
  backupPath: process.env.BACKUP_PATH || join(__dirname, '../../backups'),
  maxBackupSize: parseInt(process.env.MAX_BACKUP_SIZE) || 1024 * 1024 * 1024, // 1GB
  
  // Retention policy
  retentionPeriod: parseInt(process.env.BACKUP_RETENTION_DAYS) || 180, // 6 months
  maxBackupCount: parseInt(process.env.MAX_BACKUP_COUNT) || 100,
  
  // Compression
  compressionLevel: parseInt(process.env.BACKUP_COMPRESSION_LEVEL) || 6,
  enableCompression: process.env.BACKUP_ENABLE_COMPRESSION !== 'false',
  
  // Encryption
  enableEncryption: process.env.BACKUP_ENABLE_ENCRYPTION === 'true',
  encryptionKey: process.env.BACKUP_ENCRYPTION_KEY || null,
  encryptionAlgorithm: process.env.BACKUP_ENCRYPTION_ALGORITHM || 'aes-256-gcm',
  
  // Scheduling
  enableScheduledBackups: process.env.BACKUP_ENABLE_SCHEDULED !== 'false',
  backupSchedule: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
  enableIncrementalBackup: process.env.BACKUP_ENABLE_INCREMENTAL !== 'false',
  
  // Performance
  enableParallelProcessing: process.env.BACKUP_ENABLE_PARALLEL === 'true',
  maxConcurrency: parseInt(process.env.BACKUP_MAX_CONCURRENCY) || 3,
  
  // Cloud storage (optional)
  cloud: {
    enabled: process.env.BACKUP_CLOUD_ENABLED === 'true',
    provider: process.env.BACKUP_CLOUD_PROVIDER || null, // aws, gcp, azure
    bucket: process.env.BACKUP_CLOUD_BUCKET || null,
    region: process.env.BACKUP_CLOUD_REGION || null,
    accessKey: process.env.BACKUP_CLOUD_ACCESS_KEY || null,
    secretKey: process.env.BACKUP_CLOUD_SECRET_KEY || null
  }
};

/**
 * Logging Configuration
 */
export const loggingConfig = {
  // Log levels
  level: process.env.LOG_LEVEL || 'info',
  enableConsole: process.env.LOG_ENABLE_CONSOLE !== 'false',
  enableFile: process.env.LOG_ENABLE_FILE === 'true',
  
  // File logging
  logPath: process.env.LOG_PATH || join(__dirname, '../../logs'),
  maxFileSize: process.env.LOG_MAX_FILE_SIZE || '10m',
  maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
  
  // Log format
  format: process.env.LOG_FORMAT || 'combined', // combined, common, dev, short, tiny
  enableColors: process.env.LOG_ENABLE_COLORS !== 'false',
  enableTimestamp: process.env.LOG_ENABLE_TIMESTAMP !== 'false',
  
  // Request logging
  enableRequestLogging: process.env.LOG_ENABLE_REQUEST !== 'false',
  enableErrorLogging: process.env.LOG_ENABLE_ERROR !== 'false',
  enablePerformanceLogging: process.env.LOG_ENABLE_PERFORMANCE === 'true',
  
  // External logging services
  external: {
    enabled: process.env.LOG_EXTERNAL_ENABLED === 'true',
    service: process.env.LOG_EXTERNAL_SERVICE || null, // sentry, datadog, etc
    apiKey: process.env.LOG_EXTERNAL_API_KEY || null,
    endpoint: process.env.LOG_EXTERNAL_ENDPOINT || null
  }
};

/**
 * Monitoring Configuration
 */
export const monitoringConfig = {
  // Health checks
  enableHealthCheck: process.env.MONITORING_ENABLE_HEALTH !== 'false',
  healthCheckInterval: parseInt(process.env.MONITORING_HEALTH_INTERVAL) || 30000, // 30 seconds
  
  // Metrics collection
  enableMetrics: process.env.MONITORING_ENABLE_METRICS !== 'false',
  metricsInterval: parseInt(process.env.MONITORING_METRICS_INTERVAL) || 60000, // 1 minute
  
  // Performance monitoring
  enablePerformanceMonitoring: process.env.MONITORING_ENABLE_PERFORMANCE === 'true',
  slowRequestThreshold: parseInt(process.env.MONITORING_SLOW_THRESHOLD) || 1000, // 1 second
  
  // Alerting
  enableAlerting: process.env.MONITORING_ENABLE_ALERTING === 'true',
  alertingEndpoint: process.env.MONITORING_ALERTING_ENDPOINT || null,
  alertingApiKey: process.env.MONITORING_ALERTING_API_KEY || null,
  
  // External monitoring
  external: {
    enabled: process.env.MONITORING_EXTERNAL_ENABLED === 'true',
    service: process.env.MONITORING_EXTERNAL_SERVICE || null, // prometheus, grafana, etc
    endpoint: process.env.MONITORING_EXTERNAL_ENDPOINT || null,
    pushInterval: parseInt(process.env.MONITORING_PUSH_INTERVAL) || 60000 // 1 minute
  }
};

/**
 * Feature Flags
 */
export const featureFlags = {
  // API features
  enableApiVersioning: process.env.FEATURE_API_VERSIONING !== 'false',
  enableApiDocumentation: process.env.FEATURE_API_DOCS !== 'false',
  enableApiRateLimit: process.env.FEATURE_API_RATE_LIMIT !== 'false',
  
  // Search features
  enableSemanticSearch: process.env.FEATURE_SEMANTIC_SEARCH === 'true',
  enableSearchAnalytics: process.env.FEATURE_SEARCH_ANALYTICS === 'true',
  enableSearchCache: process.env.FEATURE_SEARCH_CACHE !== 'false',
  
  // Advanced features
  enableMachineLearning: process.env.FEATURE_ML_ENABLED === 'true',
  enableAdvancedAnalytics: process.env.FEATURE_ADVANCED_ANALYTICS === 'true',
  enableCustomIntegrations: process.env.FEATURE_CUSTOM_INTEGRATIONS === 'true',
  
  // Experimental features
  enableExperimentalFeatures: process.env.FEATURE_EXPERIMENTAL === 'true',
  enableBetaFeatures: process.env.FEATURE_BETA === 'true',
  enableDebugMode: process.env.FEATURE_DEBUG === 'true'
};

/**
 * Environment-specific configurations
 */
export const environmentConfig = {
  development: {
    enableDebugLogging: true,
    enableDetailedErrors: true,
    enableHotReload: true,
    enableMockData: true,
    disableRateLimit: true,
    enableCORS: true
  },
  
  production: {
    enableDebugLogging: false,
    enableDetailedErrors: false,
    enableHotReload: false,
    enableMockData: false,
    disableRateLimit: false,
    enableCORS: process.env.PRODUCTION_ENABLE_CORS !== 'false'
  },
  
  test: {
    enableDebugLogging: false,
    enableDetailedErrors: true,
    enableHotReload: false,
    enableMockData: true,
    disableRateLimit: true,
    enableCORS: true,
    testTimeout: parseInt(process.env.TEST_TIMEOUT) || 30000
  }
};

/**
 * Get configuration berdasarkan environment
 */
export const getEnvironmentConfig = (env = process.env.NODE_ENV || 'development') => {
  return environmentConfig[env] || environmentConfig.development;
};

/**
 * Validate configuration
 */
export const validateConfig = () => {
  const errors = [];
  const warnings = [];
  
  // Validate required environment variables
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-this-in-production') {
    errors.push('JWT_SECRET must be set to a secure value in production');
  }
  
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL && !process.env.SCYLLA_CONTACT_POINTS) {
      errors.push('Database connection must be configured in production');
    }
    
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      warnings.push('Redis connection should be configured for production');
    }
    
    if (!process.env.ELASTICSEARCH_NODE) {
      warnings.push('Elasticsearch connection should be configured for production');
    }
  }
  
  // Validate port
  if (serverConfig.port < 1 || serverConfig.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }
  
  // Validate security settings
  if (serverConfig.security.rateLimiting.maxRequests < 1) {
    errors.push('Rate limit max requests must be at least 1');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Export complete configuration
 */
export const config = {
  app: appInfo,
  server: serverConfig,
  auth: authConfig,
  cache: cacheConfig,
  search: searchConfig,
  backup: backupConfig,
  logging: loggingConfig,
  monitoring: monitoringConfig,
  features: featureFlags,
  environment: getEnvironmentConfig()
};

export default config;