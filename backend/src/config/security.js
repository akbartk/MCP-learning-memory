/**
 * ⭐️ Security Configuration for MCP Server
 * Handles CORS, rate limiting, and security headers
 */

export const securityConfig = {
  // CORS Configuration
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      // Allowed origins
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://0.0.0.0:3000',
        'http://0.0.0.0:3001',
        'http://0.0.0.0:3002',
        // Add your production domains here
        process.env.ALLOWED_ORIGINS?.split(',') || []
      ].flat();

      // Allow any IP address in development
      if (process.env.NODE_ENV === 'development') {
        // Allow any IP:port combination
        const ipPattern = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
        if (ipPattern.test(origin)) {
          return callback(null, true);
        }
      }

      // Check if origin is allowed
      if (allowedOrigins.includes(origin) || origin === '*') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Request-ID',
      'X-Agent-ID'
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
    ],
    maxAge: 86400 // 24 hours
  },

  // Security Headers
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  },

  // Rate Limiting per Tier
  rateLimiting: {
    basic: {
      windowMs: parseInt(process.env.RATE_LIMIT_BASIC_WINDOW_MS || 60000),
      max: parseInt(process.env.RATE_LIMIT_BASIC_MAX || 1000),
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false
    },
    pro: {
      windowMs: parseInt(process.env.RATE_LIMIT_PRO_WINDOW_MS || 60000),
      max: parseInt(process.env.RATE_LIMIT_PRO_MAX || 10000),
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false
    },
    enterprise: {
      windowMs: parseInt(process.env.RATE_LIMIT_ENTERPRISE_WINDOW_MS || 60000),
      max: parseInt(process.env.RATE_LIMIT_ENTERPRISE_MAX || 100000),
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false
    }
  },

  // IP Whitelist/Blacklist
  ipFilter: {
    mode: process.env.IP_FILTER_MODE || 'none', // 'whitelist', 'blacklist', 'none'
    whitelist: process.env.IP_WHITELIST?.split(',') || [],
    blacklist: process.env.IP_BLACKLIST?.split(',') || [],
    trustProxy: true // Trust X-Forwarded-For headers
  },

  // API Key Configuration
  apiKey: {
    headerName: 'X-API-Key',
    queryParam: 'apikey',
    bodyParam: 'apiKey'
  },

  // Session Configuration
  session: {
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: 'lax'
    }
  }
};

// Helper function to get client IP
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;

  // Handle IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }

  // Remove IPv6 prefix if present
  if (ip && ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }

  return ip;
}

// Middleware to check IP filtering
export function ipFilterMiddleware(req, res, next) {
  const config = securityConfig.ipFilter;

  if (config.mode === 'none') {
    return next();
  }

  const clientIp = getClientIp(req);

  if (config.mode === 'whitelist') {
    if (config.whitelist.includes(clientIp)) {
      return next();
    } else {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address is not whitelisted'
      });
    }
  }

  if (config.mode === 'blacklist') {
    if (config.blacklist.includes(clientIp)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address has been blacklisted'
      });
    } else {
      return next();
    }
  }

  next();
}

// Export default configuration
export default securityConfig;