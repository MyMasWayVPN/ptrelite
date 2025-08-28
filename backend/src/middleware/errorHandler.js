const logger = require('../utils/logger');

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    userAgent: req.get('User-Agent'),
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // Prisma errors
  if (err.code === 'P2002') {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  if (err.code === 'P2025') {
    const message = 'Record not found';
    error = { message, statusCode: 404 };
  }

  if (err.code === 'P2003') {
    const message = 'Foreign key constraint failed';
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = { message, statusCode: 400 };
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    const message = 'Too many files';
    error = { message, statusCode: 400 };
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Unexpected file field';
    error = { message, statusCode: 400 };
  }

  // Docker errors
  if (err.statusCode === 404 && err.reason === 'no such container') {
    const message = 'Container not found';
    error = { message, statusCode: 404 };
  }

  if (err.statusCode === 409 && err.reason === 'container already exists') {
    const message = 'Container already exists';
    error = { message, statusCode: 409 };
  }

  if (err.statusCode === 500 && err.reason === 'driver failed programming external connectivity') {
    const message = 'Port already in use';
    error = { message, statusCode: 400 };
  }

  // Rate limiting errors
  if (err.status === 429) {
    const message = 'Too many requests';
    error = { message, statusCode: 429 };
  }

  // Default error response
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Don't expose internal errors in production
  const response = {
    success: false,
    message: statusCode === 500 && process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : message,
  };

  // Add error details in development
  if (process.env.NODE_ENV === 'development') {
    response.error = {
      message: err.message,
      stack: err.stack,
      code: err.code,
      statusCode: err.statusCode,
    };
  }

  // Add request ID for tracking
  if (req.id) {
    response.requestId = req.id;
  }

  res.status(statusCode).json(response);
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter = 60) {
    super(message, 429, 'RATE_LIMIT_ERROR');
    this.retryAfter = retryAfter;
  }
}

class DockerError extends AppError {
  constructor(message, dockerError = null) {
    super(message, 500, 'DOCKER_ERROR');
    this.dockerError = dockerError;
  }
}

class FileSystemError extends AppError {
  constructor(message, operation = null) {
    super(message, 500, 'FILESYSTEM_ERROR');
    this.operation = operation;
  }
}

// Error response helper
const sendErrorResponse = (res, error, statusCode = 500) => {
  const response = {
    success: false,
    message: error.message || 'Internal Server Error',
  };

  if (process.env.NODE_ENV === 'development') {
    response.error = {
      stack: error.stack,
      code: error.code,
    };
  }

  res.status(statusCode).json(response);
};

// Success response helper
const sendSuccessResponse = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message,
  };

  if (data !== null) {
    response.data = data;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  errorHandler,
  asyncHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DockerError,
  FileSystemError,
  sendErrorResponse,
  sendSuccessResponse,
};
