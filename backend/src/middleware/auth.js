const jwt = require('jsonwebtoken');
const { getPrismaClient } = require('../utils/database');
const logger = require('../utils/logger');

// Verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Add user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Extract token from request
const extractToken = (req) => {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookie
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
};

// Role-based access control
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      logger.security('Unauthorized access attempt', {
        userId: req.user.id,
        userRole,
        requiredRoles: allowedRoles,
        endpoint: req.path,
        method: req.method,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Admin only access
const requireAdmin = requireRole(['ADMIN']);

// Member or Admin access
const requireMember = requireRole(['MEMBER', 'ADMIN']);

// Container ownership check
const requireContainerOwnership = async (req, res, next) => {
  try {
    const { containerId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Admin can access all containers
    if (userRole === 'ADMIN') {
      return next();
    }

    // Check if user owns the container
    const prisma = getPrismaClient();
    const container = await prisma.container.findUnique({
      where: { id: containerId },
      select: { ownerId: true }
    });

    if (!container) {
      return res.status(404).json({
        success: false,
        message: 'Container not found'
      });
    }

    if (container.ownerId !== userId) {
      logger.security('Unauthorized container access attempt', {
        userId,
        containerId,
        containerOwnerId: container.ownerId,
        endpoint: req.path,
        method: req.method,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied to this container'
      });
    }

    next();
  } catch (error) {
    logger.error('Container ownership check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authorization error'
    });
  }
};

// Optional authentication (for public endpoints that can benefit from user context)
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
        }
      });

      if (user && user.isActive) {
        req.user = user;
      }
    }
  } catch (error) {
    // Ignore errors for optional auth
    logger.debug('Optional auth failed:', error.message);
  }
  
  next();
};

// Rate limiting by user
const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    const userId = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    if (requests.has(userId)) {
      const userRequests = requests.get(userId);
      const validRequests = userRequests.filter(time => time > windowStart);
      requests.set(userId, validRequests);
    }

    // Check current requests
    const currentRequests = requests.get(userId) || [];
    
    if (currentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // Add current request
    currentRequests.push(now);
    requests.set(userId, currentRequests);

    next();
  };
};

// Audit logging middleware
const auditLog = (action, resource) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log the action after response
      setImmediate(async () => {
        try {
          if (req.user) {
            const prisma = getPrismaClient();
            await prisma.auditLog.create({
              data: {
                userId: req.user.id,
                action,
                resource,
                details: {
                  method: req.method,
                  path: req.path,
                  params: req.params,
                  query: req.query,
                  statusCode: res.statusCode,
                },
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
              },
            });
          }
        } catch (error) {
          logger.error('Audit log error:', error);
        }
      });

      originalSend.call(this, data);
    };

    next();
  };
};

module.exports = {
  verifyToken,
  requireRole,
  requireAdmin,
  requireMember,
  requireContainerOwnership,
  optionalAuth,
  userRateLimit,
  auditLog,
  extractToken,
};
