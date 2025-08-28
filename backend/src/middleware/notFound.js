const logger = require('../utils/logger');

// 404 Not Found middleware
const notFound = (req, res, next) => {
  // Log the 404 attempt
  logger.warn('404 Not Found', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    userAgent: req.get('User-Agent'),
  });

  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  });
};

module.exports = notFound;
