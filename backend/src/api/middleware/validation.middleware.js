/**
 * Validation Middleware
 * 
 * Middleware untuk validasi request body dan query parameters
 * Menggunakan Joi untuk schema validation
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import Joi from 'joi';

/**
 * Create validation middleware untuk request body atau query
 * @param {Object} schema - Joi validation schema
 * @param {string} target - Target to validate ('body' atau 'query')
 * @returns {Function} Express middleware function
 */
export const validateRequest = (schema, target = 'body') => {
  return (req, res, next) => {
    const data = target === 'query' ? req.query : req.body;
    
    const { error, value } = schema.validate(data, {
      abortEarly: false, // Show all errors
      allowUnknown: false, // Don't allow unknown fields
      stripUnknown: true // Remove unknown fields
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errorDetails.map(detail => detail.message),
        fields: errorDetails
      });
    }

    // Replace original data dengan validated dan sanitized data
    if (target === 'query') {
      req.query = value;
    } else {
      req.body = value;
    }

    next();
  };
};

/**
 * Validate UUID parameter
 */
export const validateUUID = (paramName) => {
  return (req, res, next) => {
    const uuid = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(uuid)) {
      return res.status(400).json({
        error: 'Invalid UUID format',
        details: [`Parameter '${paramName}' must be a valid UUID`]
      });
    }
    
    next();
  };
};

/**
 * Validate pagination parameters
 */
export const validatePagination = (req, res, next) => {
  const schema = Joi.object({
    limit: Joi.number().integer().min(1).max(1000).default(20),
    offset: Joi.number().integer().min(0).default(0),
    page: Joi.number().integer().min(1).optional(),
    sort: Joi.string().optional(),
    order: Joi.string().valid('asc', 'desc').default('desc')
  });

  const { error, value } = schema.validate(req.query, { allowUnknown: true });
  
  if (error) {
    return res.status(400).json({
      error: 'Invalid pagination parameters',
      details: error.details.map(detail => detail.message)
    });
  }

  // Convert page to offset jika page parameter digunakan
  if (value.page) {
    value.offset = (value.page - 1) * value.limit;
    delete value.page;
  }

  // Merge validated pagination dengan existing query
  req.query = { ...req.query, ...value };
  next();
};

/**
 * Custom validators
 */
export const customValidators = {
  /**
   * Validate email format dengan custom rules
   */
  email: () => Joi.string().email().custom((value, helpers) => {
    // Additional email validation rules
    if (value.length > 255) {
      return helpers.error('string.max', { limit: 255 });
    }
    
    // Block disposable email domains (simplified list)
    const disposableDomains = ['tempmail.org', '10minutemail.com', 'guerrillamail.com'];
    const domain = value.split('@')[1];
    
    if (disposableDomains.includes(domain)) {
      return helpers.error('email.disposable');
    }
    
    return value;
  }).messages({
    'email.disposable': 'Disposable email addresses are not allowed'
  }),

  /**
   * Validate agent ID format
   */
  agentId: () => Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).min(3).max(50)
    .messages({
      'string.pattern.base': 'Agent ID can only contain letters, numbers, hyphens, and underscores',
      'string.min': 'Agent ID must be at least 3 characters',
      'string.max': 'Agent ID must not exceed 50 characters'
    }),

  /**
   * Validate search query
   */
  searchQuery: () => Joi.string().min(2).max(500).custom((value, helpers) => {
    // Remove excessive whitespace
    const cleaned = value.trim().replace(/\s+/g, ' ');
    
    // Check for minimum meaningful content
    if (cleaned.length < 2) {
      return helpers.error('string.min', { limit: 2 });
    }
    
    // Block potentially harmful content
    const harmfulPatterns = [
      /<script/i,
      /javascript:/i,
      /vbscript:/i,
      /on\w+\s*=/i
    ];
    
    for (const pattern of harmfulPatterns) {
      if (pattern.test(cleaned)) {
        return helpers.error('search.harmful');
      }
    }
    
    return cleaned;
  }).messages({
    'search.harmful': 'Search query contains potentially harmful content'
  }),

  /**
   * Validate content text
   */
  contentText: () => Joi.string().min(10).max(10000).custom((value, helpers) => {
    const cleaned = value.trim();
    
    // Check minimum meaningful content
    if (cleaned.length < 10) {
      return helpers.error('string.min', { limit: 10 });
    }
    
    // Basic content quality check
    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount < 3) {
      return helpers.error('content.insufficient');
    }
    
    return cleaned;
  }).messages({
    'content.insufficient': 'Content must contain at least 3 words'
  }),

  /**
   * Validate file upload
   */
  fileUpload: () => Joi.object({
    filename: Joi.string().required(),
    mimetype: Joi.string().valid(
      'application/json',
      'text/plain',
      'text/csv',
      'application/pdf'
    ).required(),
    size: Joi.number().max(10 * 1024 * 1024).required() // 10MB max
  }).messages({
    'any.only': 'File type not supported. Allowed types: JSON, TXT, CSV, PDF',
    'number.max': 'File size must not exceed 10MB'
  })
};

/**
 * Sanitization helpers
 */
export const sanitizers = {
  /**
   * Sanitize HTML content
   */
  html: (value) => {
    if (typeof value !== 'string') return value;
    
    return value
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  /**
   * Sanitize untuk search queries
   */
  searchQuery: (value) => {
    if (typeof value !== 'string') return value;
    
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[<>\"']/g, '');
  },

  /**
   * Sanitize text content
   */
  textContent: (value) => {
    if (typeof value !== 'string') return value;
    
    return value
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }
};

/**
 * Error handler untuk validation errors
 */
export const handleValidationError = (error, req, res, next) => {
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details?.map(detail => detail.message) || [error.message],
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
  
  next(error);
};

/**
 * Request size validator
 */
export const validateRequestSize = (maxSize = 1024 * 1024) => { // 1MB default
  return (req, res, next) => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      return res.status(413).json({
        error: 'Request entity too large',
        details: [`Request size must not exceed ${Math.round(maxSize / 1024 / 1024)}MB`],
        max_size_bytes: maxSize
      });
    }
    
    next();
  };
};

/**
 * Content type validator
 */
export const validateContentType = (allowedTypes = ['application/json']) => {
  return (req, res, next) => {
    const contentType = req.get('Content-Type');
    
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
        return res.status(415).json({
          error: 'Unsupported media type',
          details: [`Content-Type must be one of: ${allowedTypes.join(', ')}`],
          received: contentType || 'none'
        });
      }
    }
    
    next();
  };
};

export default {
  validateRequest,
  validateUUID,
  validatePagination,
  customValidators,
  sanitizers,
  handleValidationError,
  validateRequestSize,
  validateContentType
};