const express = require('express');
const { checkDatabaseHealth } = require('../utils/database');
const { checkRedisHealth } = require('../utils/redis');
const { checkDockerHealth } = require('../utils/docker');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Basic health check
router.get('/', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  });
}));

// Detailed health check
router.get('/detailed', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  
  // Check all services
  const [database, redis, docker] = await Promise.allSettled([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkDockerHealth(),
  ]);

  const responseTime = Date.now() - startTime;

  // Determine overall status
  const services = {
    database: database.status === 'fulfilled' ? database.value : { status: 'error', message: database.reason?.message },
    redis: redis.status === 'fulfilled' ? redis.value : { status: 'error', message: redis.reason?.message },
    docker: docker.status === 'fulfilled' ? docker.value : { status: 'error', message: docker.reason?.message },
  };

  const allHealthy = Object.values(services).every(service => service.status === 'healthy');
  const overallStatus = allHealthy ? 'healthy' : 'degraded';

  // System information
  const systemInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024),
    },
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
  };

  const response = {
    success: true,
    status: overallStatus,
    timestamp: new Date().toISOString(),
    responseTime: `${responseTime}ms`,
    services,
    system: systemInfo,
  };

  // Log health check
  logger.info('Health check performed', {
    status: overallStatus,
    responseTime,
    services: Object.keys(services).reduce((acc, key) => {
      acc[key] = services[key].status;
      return acc;
    }, {}),
  });

  // Return appropriate status code
  const statusCode = overallStatus === 'healthy' ? 200 : 503;
  res.status(statusCode).json(response);
}));

// Readiness probe (for Kubernetes)
router.get('/ready', asyncHandler(async (req, res) => {
  try {
    // Check critical services
    const database = await checkDatabaseHealth();
    
    if (database.status !== 'healthy') {
      return res.status(503).json({
        success: false,
        message: 'Service not ready',
        reason: 'Database not healthy',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Service is ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      success: false,
      message: 'Service not ready',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}));

// Liveness probe (for Kubernetes)
router.get('/live', asyncHandler(async (req, res) => {
  // Simple liveness check - just return OK if server is running
  res.json({
    success: true,
    message: 'Service is alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}));

// Database health check
router.get('/database', asyncHandler(async (req, res) => {
  const health = await checkDatabaseHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  res.status(statusCode).json({
    success: health.status === 'healthy',
    service: 'database',
    ...health,
  });
}));

// Redis health check
router.get('/redis', asyncHandler(async (req, res) => {
  const health = await checkRedisHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  res.status(statusCode).json({
    success: health.status === 'healthy',
    service: 'redis',
    ...health,
  });
}));

// Docker health check
router.get('/docker', asyncHandler(async (req, res) => {
  const health = await checkDockerHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  res.status(statusCode).json({
    success: health.status === 'healthy',
    service: 'docker',
    ...health,
  });
}));

// System metrics
router.get('/metrics', asyncHandler(async (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  res.json({
    success: true,
    metrics: {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024), // MB
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
}));

module.exports = router;
