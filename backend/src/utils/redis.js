const Redis = require('ioredis');
const logger = require('./logger');

let redis;

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
};

// Connect to Redis
async function connectRedis() {
  try {
    if (!redis) {
      redis = new Redis(process.env.REDIS_URL || redisConfig);

      // Event listeners
      redis.on('connect', () => {
        logger.info('✅ Redis connected successfully');
      });

      redis.on('ready', () => {
        logger.info('✅ Redis ready to accept commands');
      });

      redis.on('error', (error) => {
        logger.error('❌ Redis connection error:', error);
      });

      redis.on('close', () => {
        logger.warn('⚠️ Redis connection closed');
      });

      redis.on('reconnecting', (delay) => {
        logger.info(`🔄 Redis reconnecting in ${delay}ms`);
      });

      // Test connection
      await redis.connect();
      await redis.ping();
      logger.info('✅ Redis ping successful');
    }

    return redis;
  } catch (error) {
    logger.error('❌ Failed to connect to Redis:', error);
    throw error;
  }
}

// Disconnect from Redis
async function disconnectRedis() {
  try {
    if (redis) {
      await redis.quit();
      logger.info('✅ Redis disconnected');
    }
  } catch (error) {
    logger.error('❌ Error disconnecting from Redis:', error);
  }
}

// Get Redis client instance
function getRedisClient() {
  if (!redis) {
    throw new Error('Redis not connected. Call connectRedis() first.');
  }
  return redis;
}

// Redis health check
async function checkRedisHealth() {
  try {
    if (!redis) {
      return { status: 'disconnected', message: 'Redis not connected' };
    }

    const pong = await redis.ping();
    if (pong === 'PONG') {
      return { 
        status: 'healthy', 
        message: 'Redis connection is healthy',
        timestamp: new Date().toISOString()
      };
    } else {
      return { 
        status: 'unhealthy', 
        message: 'Redis ping failed',
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return { 
      status: 'unhealthy', 
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Cache helpers
class CacheManager {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  // Set cache with TTL
  async set(key, value, ttl = 3600) {
    try {
      const serializedValue = JSON.stringify(value);
      await this.redis.setex(key, ttl, serializedValue);
      return true;
    } catch (error) {
      logger.error('Cache set error:', error);
      return false;
    }
  }

  // Get cache
  async get(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  // Delete cache
  async del(key) {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      logger.error('Cache delete error:', error);
      return false;
    }
  }

  // Check if key exists
  async exists(key) {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  }

  // Set TTL for existing key
  async expire(key, ttl) {
    try {
      await this.redis.expire(key, ttl);
      return true;
    } catch (error) {
      logger.error('Cache expire error:', error);
      return false;
    }
  }

  // Get multiple keys
  async mget(keys) {
    try {
      const values = await this.redis.mget(keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error('Cache mget error:', error);
      return keys.map(() => null);
    }
  }

  // Set multiple keys
  async mset(keyValuePairs, ttl = 3600) {
    try {
      const pipeline = this.redis.pipeline();
      
      for (const [key, value] of Object.entries(keyValuePairs)) {
        const serializedValue = JSON.stringify(value);
        pipeline.setex(key, ttl, serializedValue);
      }
      
      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('Cache mset error:', error);
      return false;
    }
  }

  // Increment counter
  async incr(key, ttl = 3600) {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, ttl);
      const results = await pipeline.exec();
      return results[0][1]; // Return the incremented value
    } catch (error) {
      logger.error('Cache incr error:', error);
      return 0;
    }
  }

  // Get keys by pattern
  async keys(pattern) {
    try {
      return await this.redis.keys(pattern);
    } catch (error) {
      logger.error('Cache keys error:', error);
      return [];
    }
  }

  // Clear all cache (use with caution)
  async flushall() {
    try {
      await this.redis.flushall();
      return true;
    } catch (error) {
      logger.error('Cache flushall error:', error);
      return false;
    }
  }
}

// Session management helpers
class SessionManager {
  constructor(redisClient) {
    this.redis = redisClient;
    this.prefix = 'session:';
  }

  // Create session
  async create(sessionId, data, ttl = 86400) { // 24 hours default
    try {
      const key = `${this.prefix}${sessionId}`;
      await this.redis.setex(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      logger.error('Session create error:', error);
      return false;
    }
  }

  // Get session
  async get(sessionId) {
    try {
      const key = `${this.prefix}${sessionId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Session get error:', error);
      return null;
    }
  }

  // Update session
  async update(sessionId, data, ttl = 86400) {
    return await this.create(sessionId, data, ttl);
  }

  // Delete session
  async destroy(sessionId) {
    try {
      const key = `${this.prefix}${sessionId}`;
      await this.redis.del(key);
      return true;
    } catch (error) {
      logger.error('Session destroy error:', error);
      return false;
    }
  }

  // Extend session TTL
  async extend(sessionId, ttl = 86400) {
    try {
      const key = `${this.prefix}${sessionId}`;
      await this.redis.expire(key, ttl);
      return true;
    } catch (error) {
      logger.error('Session extend error:', error);
      return false;
    }
  }
}

module.exports = {
  connectRedis,
  disconnectRedis,
  getRedisClient,
  checkRedisHealth,
  CacheManager,
  SessionManager,
};
