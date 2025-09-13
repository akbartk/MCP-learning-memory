/**
 * MCP Server Learning-AI + Memory - Main Application
 * 
 * Express.js application dengan comprehensive middleware stack
 * Routes untuk authentication, notes, knowledge, experiences, sessions, dan monitoring
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config/app.js';
import { getConfig as getDatabaseConfig, validateConfig as validateDatabaseConfig } from './config/database.js';
import securityConfig, { ipFilterMiddleware, getClientIp } from './config/security.js';

// Import middleware
import { errorHandler, notFoundHandler, setupGlobalErrorHandlers } from './api/middleware/error-handler.middleware.js';
import { rateLimitGlobal } from './api/middleware/rate-limit.middleware.js';
import { validateContentType, validateRequestSize } from './api/middleware/validation.middleware.js';

// Import routes
import authRoutes from './api/routes/auth.routes.js';
import notesRoutes from './api/routes/notes.routes.js';
import knowledgeRoutes from './api/routes/knowledge.routes.js';
import experienceRoutes from './api/routes/experience.routes.js';
import sessionRoutes from './api/routes/session.routes.js';
import monitoringRoutes from './api/routes/monitoring.routes.js';

// Import shared services
import sharedServices from './services/shared-services.js';

/**
 * Create Express application
 */
const app = express();

/**
 * Application configuration validation
 */
function validateApplicationConfig() {
  console.log('🔍 Validating application configuration...');
  
  // Validate app config
  const appValidation = config.validateConfig ? config.validateConfig() : { valid: true, errors: [], warnings: [] };
  
  // Validate database config
  const dbConfig = getDatabaseConfig();
  const dbValidation = validateDatabaseConfig(dbConfig);
  
  const allErrors = [...(appValidation.errors || []), ...(dbValidation.errors || [])];
  const allWarnings = [...(appValidation.warnings || []), ...(dbValidation.warnings || [])];
  
  if (allErrors.length > 0) {
    console.error('❌ Configuration validation failed:');
    allErrors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  
  if (allWarnings.length > 0) {
    console.warn('⚠️  Configuration warnings:');
    allWarnings.forEach(warning => console.warn(`  - ${warning}`));
  }
  
  console.log('✅ Configuration validation passed');
}

/**
 * Setup global error handlers
 */
setupGlobalErrorHandlers();

/**
 * Initialize services using shared services
 */
async function initializeServices() {
  try {
    await sharedServices.initialize();
  } catch (error) {
    console.error('❌ Service initialization failed:', error);
    throw error;
  }
}

/**
 * Security middleware setup
 */
function setupSecurity() {
  // Trust proxy - important for getting real IP behind reverse proxy
  app.set('trust proxy', true);

  // IP filtering middleware
  app.use(ipFilterMiddleware);

  // Log client IPs for monitoring
  app.use((req, res, next) => {
    req.clientIp = getClientIp(req);
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Client IP: ${req.clientIp}`);
    next();
  });

  // Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: securityConfig.helmet.contentSecurityPolicy || config.server.security.helmet.contentSecurityPolicy,
    crossOriginEmbedderPolicy: securityConfig.helmet.crossOriginEmbedderPolicy || config.server.security.helmet.crossOriginEmbedderPolicy,
    crossOriginOpenerPolicy: config.server.security.helmet.crossOriginOpenerPolicy,
    crossOriginResourcePolicy: config.server.security.helmet.crossOriginResourcePolicy,
    hsts: config.server.security.helmet.hsts
  }));

  // CORS configuration - enhanced for 0.0.0.0 access
  app.use(cors(securityConfig.cors));

  console.log('✅ Security middleware configured');
}

/**
 * Basic middleware setup
 */
function setupBasicMiddleware() {
  // Compression
  app.use(compression());

  // Request parsing
  app.use(express.json({ 
    limit: config.server.limits.bodySize,
    strict: true
  }));
  
  app.use(express.urlencoded({ 
    extended: true, 
    limit: config.server.limits.bodySize,
    parameterLimit: config.server.limits.parameterLimit
  }));

  // Request size validation
  app.use(validateRequestSize(
    parseInt(config.server.limits.bodySize.replace(/\D/g, '')) * 1024 * 1024
  ));

  // Content type validation untuk POST/PUT/PATCH
  app.use(validateContentType(['application/json', 'application/x-www-form-urlencoded']));

  // Request ID middleware
  app.use((req, res, next) => {
    req.id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    res.set('X-Request-ID', req.id);
    next();
  });

  // Request logging middleware
  if (config.logging.enableRequestLogging) {
    app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const logData = {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          requestId: req.id
        };
        
        if (res.statusCode >= 400) {
          console.error('❌ Request failed:', JSON.stringify(logData));
        } else if (config.logging.enablePerformanceLogging && duration > 1000) {
          console.warn('⚡ Slow request:', JSON.stringify(logData));
        } else {
          console.log('📝 Request:', JSON.stringify(logData));
        }
      });
      
      next();
    });
  }

  console.log('✅ Basic middleware configured');
}

/**
 * API routes setup
 */
function setupRoutes() {
  const apiPrefix = config.server.apiPrefix;

  // Health check route (tidak memerlukan auth)
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: config.app.version,
      environment: config.server.environment,
      uptime: process.uptime()
    });
  });

  // API info route
  app.get(`${apiPrefix}/info`, (req, res) => {
    res.json({
      name: config.app.name,
      version: config.app.version,
      description: config.app.description,
      api_version: config.server.apiVersion,
      environment: config.server.environment,
      build: config.app.build,
      documentation: process.env.API_DOCS_URL || `${req.protocol}://${req.get('host')}${apiPrefix}/docs`,
      support: {
        email: 'support@mcp-server.ai',
        documentation: 'https://docs.mcp-server.ai',
        github: config.app.repository
      },
      rate_limits: {
        note: 'Rate limits vary by subscription tier',
        documentation: `${req.protocol}://${req.get('host')}${apiPrefix}/docs#rate-limits`
      }
    });
  });

  // Global rate limiting (jika enabled)
  if (config.features.enableApiRateLimit && !config.environment.disableRateLimit) {
    app.use(apiPrefix, rateLimitGlobal);
  }

  // API routes
  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/notes`, notesRoutes);
  app.use(`${apiPrefix}/knowledge`, knowledgeRoutes);
  app.use(`${apiPrefix}/experiences`, experienceRoutes);
  app.use(`${apiPrefix}/sessions`, sessionRoutes);
  app.use(`${apiPrefix}`, monitoringRoutes); // /metrics, /health di level root

  // API documentation route (jika enabled)
  if (config.features.enableApiDocumentation) {
    app.get(`${apiPrefix}/docs`, (req, res) => {
      res.json({
        message: 'API Documentation',
        openapi_spec: `${req.protocol}://${req.get('host')}/openapi.yaml`,
        interactive_docs: `${req.protocol}://${req.get('host')}/docs/`,
        endpoints: {
          authentication: `${apiPrefix}/auth`,
          notes: `${apiPrefix}/notes`,
          knowledge: `${apiPrefix}/knowledge`,
          experiences: `${apiPrefix}/experiences`,
          sessions: `${apiPrefix}/sessions`,
          monitoring: `${apiPrefix}/metrics`
        }
      });
    });
  }

  console.log('✅ API routes configured');
}

/**
 * Error handling setup
 */
function setupErrorHandling() {
  // 404 handler untuk undefined routes
  app.use(notFoundHandler);

  // Global error handler (harus terakhir)
  app.use(errorHandler);

  console.log('✅ Error handling configured');
}

/**
 * Graceful shutdown setup
 */
function setupGracefulShutdown(server) {
  const signals = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
      
      // Stop accepting new connections
      server.close(async () => {
        console.log('🔌 HTTP server closed');
        
        try {
          // Close shared services
          await sharedServices.close();
          
          console.log('✅ Graceful shutdown completed');
          process.exit(0);
          
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });
      
      // Force shutdown after timeout
      setTimeout(() => {
        console.error('❌ Forced shutdown due to timeout');
        process.exit(1);
      }, 30000); // 30 seconds timeout
    });
  });
}

/**
 * Start server
 */
async function startServer() {
  try {
    // Validate configuration
    validateApplicationConfig();
    
    // Initialize services
    await initializeServices();
    
    // Setup middleware dan routes
    setupSecurity();
    setupBasicMiddleware();
    setupRoutes();
    setupErrorHandling();
    
    // Start HTTP server
    const server = app.listen(config.server.port, config.server.host, () => {
      console.log('\n🚀 MCP Server started successfully!');
      console.log(`📍 Server: http://${config.server.host}:${config.server.port}`);
      console.log(`🔗 API: http://${config.server.host}:${config.server.port}${config.server.apiPrefix}`);
      console.log(`📊 Health: http://${config.server.host}:${config.server.port}/health`);
      console.log(`🌍 Environment: ${config.server.environment}`);
      console.log(`📖 Version: ${config.app.version}`);
      
      if (config.features.enableApiDocumentation) {
        console.log(`📚 Docs: http://${config.server.host}:${config.server.port}${config.server.apiPrefix}/docs`);
      }
      
      console.log('\n✅ Server is ready to accept connections\n');
    });

    // Configure server timeouts
    server.timeout = config.server.limits.requestTimeout;
    server.headersTimeout = config.server.limits.headerTimeout;
    server.keepAliveTimeout = config.server.limits.keepAliveTimeout;

    // Setup graceful shutdown
    setupGracefulShutdown(server);
    
    return server;
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  process.exit(1);
});

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

/**
 * Start the application
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(error => {
    console.error('❌ Application startup failed:', error);
    process.exit(1);
  });
}

// Export untuk testing
export { app, startServer };
export default app;