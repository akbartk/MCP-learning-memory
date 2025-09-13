/**
 * Error Handler Middleware
 * 
 * Central error handling untuk Express application
 * Handles different types of errors dan provides consistent error responses
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

/**
 * Main error handling middleware
 * Must be last middleware dalam Express app
 */
export const errorHandler = (error, req, res, next) => {
  // Log error dengan context
  logError(error, req);

  // Don't handle error jika response sudah sent
  if (res.headersSent) {
    return next(error);
  }

  // Determine error type dan create appropriate response
  const errorResponse = createErrorResponse(error, req);

  res.status(errorResponse.status).json(errorResponse.body);
};

/**
 * Create standardized error response
 */
function createErrorResponse(error, req) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const timestamp = new Date().toISOString();
  const requestId = req.id || generateRequestId();

  // Base error response
  const response = {
    status: 500,
    body: {
      error: 'Internal server error',
      details: ['An unexpected error occurred'],
      timestamp,
      request_id: requestId
    }
  };

  // Handle specific error types
  if (error.name === 'ValidationError') {
    response.status = 400;
    response.body.error = 'Validation failed';
    response.body.details = error.details?.map(d => d.message) || [error.message];
  }
  
  else if (error.name === 'JsonWebTokenError') {
    response.status = 401;
    response.body.error = 'Invalid authentication token';
    response.body.details = ['The provided authentication token is invalid'];
  }
  
  else if (error.name === 'TokenExpiredError') {
    response.status = 401;
    response.body.error = 'Authentication token expired';
    response.body.details = ['The authentication token has expired'];
  }
  
  else if (error.name === 'UnauthorizedError') {
    response.status = 401;
    response.body.error = 'Unauthorized access';
    response.body.details = [error.message || 'Authentication required'];
  }
  
  else if (error.name === 'ForbiddenError' || error.status === 403) {
    response.status = 403;
    response.body.error = 'Access forbidden';
    response.body.details = [error.message || 'You do not have permission to access this resource'];
  }
  
  else if (error.name === 'NotFoundError' || error.status === 404) {
    response.status = 404;
    response.body.error = 'Resource not found';
    response.body.details = [error.message || 'The requested resource was not found'];
  }
  
  else if (error.name === 'ConflictError' || error.status === 409) {
    response.status = 409;
    response.body.error = 'Resource conflict';
    response.body.details = [error.message || 'The request conflicts with the current state'];
  }
  
  else if (error.status === 413 || error.code === 'LIMIT_FILE_SIZE') {
    response.status = 413;
    response.body.error = 'Request entity too large';
    response.body.details = ['The request body or file is too large'];
  }
  
  else if (error.status === 415) {
    response.status = 415;
    response.body.error = 'Unsupported media type';
    response.body.details = ['The media type of the request is not supported'];
  }
  
  else if (error.status === 429 || error.message.includes('rate limit')) {
    response.status = 429;
    response.body.error = 'Rate limit exceeded';
    response.body.details = ['Too many requests. Please try again later.'];
    
    if (error.retryAfter) {
      response.body.retry_after = error.retryAfter;
    }
  }
  
  else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    response.status = 503;
    response.body.error = 'Service unavailable';
    response.body.details = ['External service is temporarily unavailable'];
  }
  
  else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    response.status = 504;
    response.body.error = 'Request timeout';
    response.body.details = ['The request took too long to complete'];
  }
  
  else if (error.name === 'DatabaseError' || error.code?.startsWith('DB_')) {
    response.status = 500;
    response.body.error = 'Database error';
    response.body.details = ['A database error occurred'];
  }
  
  else if (error.name === 'NetworkError' || error.code?.startsWith('NET_')) {
    response.status = 502;
    response.body.error = 'Network error';
    response.body.details = ['A network error occurred'];
  }
  
  else if (error.status && error.status >= 400 && error.status < 600) {
    response.status = error.status;
    response.body.error = error.message || 'Request failed';
    response.body.details = error.details || [error.message || 'Request failed'];
  }

  // Add development details
  if (isDevelopment) {
    response.body.debug = {
      error_name: error.name,
      error_message: error.message,
      stack: error.stack,
      error_code: error.code,
      request_details: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params
      }
    };
  }

  return response;
}

/**
 * Log error dengan appropriate level dan context
 */
function logError(error, req) {
  const errorContext = {
    error_name: error.name,
    error_message: error.message,
    error_stack: error.stack,
    error_code: error.code,
    request_id: req.id || generateRequestId(),
    method: req.method,
    url: req.url,
    user_id: req.user?.id || 'anonymous',
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  };

  // Determine log level berdasarkan error type
  if (error.status && error.status < 500) {
    // Client errors (4xx) - log as warning
    console.warn('⚠️ Client error:', JSON.stringify(errorContext, null, 2));
  } else {
    // Server errors (5xx) dan unexpected errors - log as error
    console.error('❌ Server error:', JSON.stringify(errorContext, null, 2));
  }

  // Send to monitoring service jika configured
  if (process.env.ERROR_MONITORING_URL) {
    sendToMonitoring(errorContext).catch(monitoringError => {
      console.error('❌ Failed to send error to monitoring:', monitoringError);
    });
  }
}

/**
 * Send error ke external monitoring service
 */
async function sendToMonitoring(errorContext) {
  try {
    // Implementation would depend on monitoring service (e.g., Sentry, DataDog)
    console.log('📊 Sending error to monitoring service:', errorContext.request_id);
  } catch (error) {
    console.error('❌ Monitoring service error:', error);
  }
}

/**
 * Generate unique request ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 404 Not Found handler
 * Handle requests untuk non-existent routes
 */
export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.status = 404;
  error.name = 'NotFoundError';
  
  next(error);
};

/**
 * Async error handler untuk async routes
 */
export const asyncErrorHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Handle uncaught exceptions dan unhandled rejections
 */
export const setupGlobalErrorHandlers = () => {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    
    // Log error
    const errorContext = {
      error_name: error.name,
      error_message: error.message,
      error_stack: error.stack,
      type: 'uncaught_exception',
      timestamp: new Date().toISOString()
    };
    
    console.error('❌ Fatal error:', JSON.stringify(errorContext, null, 2));
    
    // Graceful shutdown
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    
    const errorContext = {
      reason: reason?.toString(),
      stack: reason?.stack,
      type: 'unhandled_rejection',
      timestamp: new Date().toISOString()
    };
    
    console.error('❌ Unhandled rejection:', JSON.stringify(errorContext, null, 2));
  });

  // Handle warnings
  process.on('warning', (warning) => {
    console.warn('⚠️ Process warning:', warning);
  });
};

/**
 * Validation error formatter
 */
export const formatValidationError = (validationResult) => {
  if (!validationResult.error) {
    return null;
  }

  const error = new Error('Validation failed');
  error.name = 'ValidationError';
  error.status = 400;
  error.details = validationResult.error.details.map(detail => ({
    field: detail.path.join('.'),
    message: detail.message,
    value: detail.context?.value
  }));

  return error;
};

/**
 * Database error handler
 */
export const handleDatabaseError = (error) => {
  const dbError = new Error('Database operation failed');
  dbError.name = 'DatabaseError';
  dbError.status = 500;
  dbError.code = error.code;
  dbError.originalError = error;

  // Handle specific database errors
  if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
    dbError.status = 409;
    dbError.message = 'Resource already exists';
  } else if (error.code === 'ER_NO_REFERENCED_ROW' || error.code === '23503') {
    dbError.status = 400;
    dbError.message = 'Referenced resource does not exist';
  } else if (error.code === 'ECONNREFUSED') {
    dbError.status = 503;
    dbError.message = 'Database connection failed';
  }

  return dbError;
};

/**
 * API error classes
 */
export class APIError extends Error {
  constructor(message, status = 500, details = []) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.details = Array.isArray(details) ? details : [details];
  }
}

export class ValidationError extends APIError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends APIError {
  constructor(message = 'Authentication required', details = []) {
    super(message, 401, details);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends APIError {
  constructor(message = 'Access forbidden', details = []) {
    super(message, 403, details);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends APIError {
  constructor(message = 'Resource not found', details = []) {
    super(message, 404, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends APIError {
  constructor(message = 'Resource conflict', details = []) {
    super(message, 409, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends APIError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 429, ['Too many requests. Please try again later.']);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export default {
  errorHandler,
  notFoundHandler,
  asyncErrorHandler,
  setupGlobalErrorHandlers,
  formatValidationError,
  handleDatabaseError,
  APIError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError
};