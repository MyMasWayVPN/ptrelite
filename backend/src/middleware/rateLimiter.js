const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../utils/redis');
const logger = require('../utils/logger');

// Redis store for rate limiting
class RedisStore {
  constructor(redisClient, prefix = 'rl:') {
    this.redis = redisClient;
    this.prefix = prefix;
  }

  async increment(key) {
    try {
      const fullKey = `${this.prefix}${key}`;
      const current = await this.redis.incr(fullKey);
      
      if (current === 1) {
        // Set expiration on first increment
        await this.redis.expire(fullKey, 900); // 15 minutes
      }
      
      const ttl = await this.redis.ttl(fullKey);
      return {
        totalHits: current,
        resetTime: new Date(Date.now() + ttl * 1000)
      };
    } catch (error) {
      logger.error('Redis rate limiter error:', error);
      // Fallback to allowing request if Redis fails
      return {
        totalHits: 1,
        resetTime: new Date(Date.now() + 900000)
      };
    }
  }

  async decrement(key) {
    try {
      const fullKey = `${this.prefix}${key}`;
      await this.redis.decr(fullKey);
    } catch (error) {
      logger.error('Redis rate limiter decrement error:', error);
    }
  }

  async resetKey(key) {
    try {
      const fullKey = `${this.prefix}${key}`;
      await this.redis.del(fullKey);
    } catch (error) {
      logger.error('Redis rate limiter reset error:', error);
    }
  }
}

// Create Redis store instance
let redisStore;
try {
  const redis = getRedisClient();
  redisStore = new RedisStore(redis);
} catch (error) {
  logger.warn('Redis not available for rate limiting, using memory store');
  redisStore = null;
}

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  store: redisStore,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    return req.user?.id || req.ip;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.',
      retryAfter: Math.ceil(15 * 60) // seconds
    });
  }
});

// Strict rate limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  keyGenerator: (req) => {
    return req.user?.id || req.ip;
  },
  handler: (req, res) => {
    logger.security('Strict rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many attempts, please try again later.',
      retryAfter: Math.ceil(15 * 60)
    });
  }
});

// Login rate limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login attempts per windowMs
  message: {
    success: false,
    message: 'Too many login attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  keyGenerator: (req) => {
    // Combine IP and username for more granular limiting
    const username = req.body?.username || 'unknown';
    return `login:${req.ip}:${username}`;
  },
  handler: (req, res) => {
    logger.security('Login rate limit exceeded', {
      ip: req.ip,
      username: req.body?.username,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many login attempts, please try again later.',
      retryAfter: Math.ceil(15 * 60)
    });
  }
});

// Container operation rate limiter
const containerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // limit each user to 20 container operations per 5 minutes
  message: {
    success: false,
    message: 'Too many container operations, please slow down.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  keyGenerator: (req) => {
    return `container:${req.user?.id || req.ip}`;
  },
  handler: (req, res) => {
    logger.warn('Container operation rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many container operations, please slow down.',
      retryAfter: Math.ceil(5 * 60)
    });
  }
});

// File operation rate limiter
const fileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // limit each user to 50 file operations per 10 minutes
  message: {
    success: false,
    message: 'Too many file operations, please slow down.',
    retryAfter: '10 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  keyGenerator: (req) => {
    return `file:${req.user?.id || req.ip}`;
  },
  handler: (req, res) => {
    logger.warn('File operation rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many file operations, please slow down.',
      retryAfter: Math.ceil(10 * 60)
    });
  }
});

// API rate limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each user to 60 API requests per minute
  message: {
    success: false,
    message: 'API rate limit exceeded, please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  keyGenerator: (req) => {
    return `api:${req.user?.id || req.ip}`;
  },
  handler: (req, res) => {
    logger.warn('API rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      message: 'API rate limit exceeded, please slow down.',
      retryAfter: 60
    });
  }
});

// Custom rate limiter factory
const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests',
    keyPrefix = 'custom',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore,
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator: (req) => {
      return `${keyPrefix}:${req.user?.id || req.ip}`;
    },
    handler: (req, res) => {
      logger.warn(`${keyPrefix} rate limit exceeded`, {
        ip: req.ip,
        userId: req.user?.id,
        path: req.path,
        method: req.method
      });
      
      res.status(429).json({
        success: false,
        message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

module.exports = {
  generalLimiter,
  strictLimiter,
  loginLimiter,
  containerLimiter,
  fileLimiter,
  apiLimiter,
  createRateLimiter,
  RedisStore,
};

// Export default as general limiter
module.exports.default = generalLimiter;
