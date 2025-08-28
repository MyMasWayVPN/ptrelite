const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create transports
const transports = [];

// Console transport for development
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: 'debug'
    })
  );
}

// File transports
transports.push(
  // All logs
  new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat,
    level: 'info'
  }),
  
  // Error logs
  new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    format: logFormat,
    level: 'error'
  }),
  
  // Audit logs (for security events)
  new DailyRotateFile({
    filename: path.join(logsDir, 'audit-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '90d',
    format: logFormat,
    level: 'info'
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
  exitOnError: false
});

// Add custom methods for specific log types
logger.audit = (message, meta = {}) => {
  logger.info(message, { ...meta, type: 'audit' });
};

logger.security = (message, meta = {}) => {
  logger.warn(message, { ...meta, type: 'security' });
};

logger.performance = (message, meta = {}) => {
  logger.info(message, { ...meta, type: 'performance' });
};

// Log unhandled exceptions and rejections
logger.exceptions.handle(
  new winston.transports.File({ 
    filename: path.join(logsDir, 'exceptions.log'),
    format: logFormat
  })
);

logger.rejections.handle(
  new winston.transports.File({ 
    filename: path.join(logsDir, 'rejections.log'),
    format: logFormat
  })
);

module.exports = logger;
