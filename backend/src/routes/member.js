const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { getPrismaClient } = require('../utils/database');
const { verifyToken, requireMember, auditLog } = require('../middleware/auth');
const { asyncHandler, sendSuccessResponse, ValidationError, NotFoundError, ConflictError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// All member routes require member or admin role
router.use(verifyToken, requireMember);

// Validation rules
const updateProfileValidation = [
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number'),
];

// Dashboard Routes

// @desc    Get member dashboard data
// @route   GET /api/member/dashboard
// @access  Private/Member
router.get('/dashboard', asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();
  const userId = req.user.id;

  // Get user's containers
  const containers = await prisma.container.findMany({
    where: { ownerId: userId },
    include: {
      tunnels: {
        select: {
          id: true,
          domain: true,
          status: true,
        },
      },
      _count: {
        select: {
          logs: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Get recent activity logs
  const recentLogs = await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
    take: 10,
    select: {
      id: true,
      action: true,
      resource: true,
      timestamp: true,
      details: true,
    },
  });

  // Get user sessions
  const activeSessions = await prisma.userSession.count({
    where: {
      userId,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  // Calculate statistics
  const stats = {
    totalContainers: containers.length,
    runningContainers: containers.filter(c => c.status === 'RUNNING').length,
    stoppedContainers: containers.filter(c => c.status === 'STOPPED').length,
    activeTunnels: containers.reduce((acc, c) => acc + c.tunnels.filter(t => t.status === 'ACTIVE').length, 0),
    totalLogs: containers.reduce((acc, c) => acc + c._count.logs, 0),
    activeSessions,
  };

  // Get container limits
  const maxContainers = parseInt(process.env.MAX_CONTAINERS_PER_MEMBER) || 1;
  const canCreateContainer = containers.length < maxContainers;

  sendSuccessResponse(res, {
    stats,
    containers,
    recentLogs,
    limits: {
      maxContainers,
      canCreateContainer,
      remainingContainers: Math.max(0, maxContainers - containers.length),
    },
  }, 'Dashboard data retrieved successfully');
}));

// Profile Management Routes

// @desc    Get member profile
// @route   GET /api/member/profile
// @access  Private/Member
router.get('/profile', asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();
  
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          containers: true,
          logs: true,
          sessions: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  sendSuccessResponse(res, { user }, 'Profile retrieved successfully');
}));

// @desc    Update member profile
// @route   PUT /api/member/profile
// @access  Private/Member
router.put('/profile', updateProfileValidation, auditLog('PROFILE_UPDATE', 'USER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { username, email } = req.body;
  const prisma = getPrismaClient();
  const userId = req.user.id;

  // Check for username/email conflicts
  if (username || email) {
    const conflictUser = await prisma.user.findFirst({
      where: {
        AND: [
          { id: { not: userId } },
          {
            OR: [
              username ? { username } : {},
              email ? { email } : {},
            ].filter(obj => Object.keys(obj).length > 0),
          },
        ],
      },
    });

    if (conflictUser) {
      throw new ConflictError('Username or email already exists');
    }
  }

  // Update profile
  const updateData = {};
  if (username) updateData.username = username;
  if (email) updateData.email = email;

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  logger.audit('Profile updated', {
    userId,
    changes: updateData,
    ip: req.ip,
  });

  sendSuccessResponse(res, { user }, 'Profile updated successfully');
}));

// @desc    Change password
// @route   PUT /api/member/change-password
// @access  Private/Member
router.put('/change-password', changePasswordValidation, auditLog('PASSWORD_CHANGE', 'USER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { currentPassword, newPassword } = req.body;
  const prisma = getPrismaClient();
  const userId = req.user.id;

  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      password: true,
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Verify current password
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    throw new ValidationError('Current password is incorrect');
  }

  // Hash new password
  const hashedNewPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword },
  });

  // Invalidate all sessions except current one
  const currentRefreshToken = req.cookies.refreshToken;
  await prisma.userSession.deleteMany({
    where: {
      userId,
      refreshToken: {
        not: currentRefreshToken,
      },
    },
  });

  logger.audit('Password changed', {
    userId,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Password changed successfully');
}));

// Container Management Routes

// @desc    Get member's containers
// @route   GET /api/member/containers
// @access  Private/Member
router.get('/containers', asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const prisma = getPrismaClient();
  const userId = req.user.id;

  // Build where clause
  const where = { ownerId: userId };
  if (status) {
    where.status = status.toUpperCase();
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { image: { contains: search, mode: 'insensitive' } },
    ];
  }

  const containers = await prisma.container.findMany({
    where,
    include: {
      tunnels: {
        select: {
          id: true,
          domain: true,
          status: true,
        },
      },
      _count: {
        select: {
          logs: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Get container limits
  const maxContainers = parseInt(process.env.MAX_CONTAINERS_PER_MEMBER) || 1;
  const canCreateContainer = containers.length < maxContainers;

  sendSuccessResponse(res, {
    containers,
    limits: {
      maxContainers,
      canCreateContainer,
      remainingContainers: Math.max(0, maxContainers - containers.length),
    },
  }, 'Containers retrieved successfully');
}));

// @desc    Get container by ID (member's own)
// @route   GET /api/member/containers/:id
// @access  Private/Member
router.get('/containers/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();
  const userId = req.user.id;

  const container = await prisma.container.findFirst({
    where: {
      id,
      ownerId: userId,
    },
    include: {
      tunnels: true,
      logs: {
        orderBy: { timestamp: 'desc' },
        take: 50,
      },
    },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  sendSuccessResponse(res, { container }, 'Container retrieved successfully');
}));

// Activity & Logs Routes

// @desc    Get member's activity logs
// @route   GET /api/member/logs
// @access  Private/Member
router.get('/logs', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, action, resource, startDate, endDate } = req.query;
  const prisma = getPrismaClient();
  const userId = req.user.id;

  // Build where clause
  const where = { userId };
  if (action) {
    where.action = { contains: action, mode: 'insensitive' };
  }
  if (resource) {
    where.resource = { contains: resource, mode: 'insensitive' };
  }
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) {
      where.timestamp.gte = new Date(startDate);
    }
    if (endDate) {
      where.timestamp.lte = new Date(endDate);
    }
  }

  // Get logs with pagination
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        resource: true,
        details: true,
        ipAddress: true,
        timestamp: true,
      },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit),
    }),
    prisma.auditLog.count({ where }),
  ]);

  sendSuccessResponse(res, {
    logs,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  }, 'Activity logs retrieved successfully');
}));

// Session Management Routes

// @desc    Get member's active sessions
// @route   GET /api/member/sessions
// @access  Private/Member
router.get('/sessions', asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();
  const userId = req.user.id;

  const sessions = await prisma.userSession.findMany({
    where: { userId },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      refreshToken: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Mark current session
  const currentRefreshToken = req.cookies.refreshToken;
  const sessionsWithCurrent = sessions.map(session => ({
    id: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isCurrent: session.refreshToken === currentRefreshToken,
    isExpired: session.expiresAt < new Date(),
  }));

  sendSuccessResponse(res, { sessions: sessionsWithCurrent }, 'Sessions retrieved successfully');
}));

// @desc    Revoke session
// @route   DELETE /api/member/sessions/:sessionId
// @access  Private/Member
router.delete('/sessions/:sessionId', auditLog('SESSION_REVOKE', 'AUTH'), asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const prisma = getPrismaClient();
  const userId = req.user.id;

  const session = await prisma.userSession.findFirst({
    where: {
      id: sessionId,
      userId,
    },
  });

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  await prisma.userSession.delete({
    where: { id: sessionId },
  });

  logger.audit('Session revoked', {
    userId,
    sessionId,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Session revoked successfully');
}));

// Statistics Routes

// @desc    Get member's statistics
// @route   GET /api/member/stats
// @access  Private/Member
router.get('/stats', asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();
  const userId = req.user.id;

  // Get statistics for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalContainers,
    runningContainers,
    totalLogs,
    recentLogs,
    activeTunnels,
    activeSessions,
  ] = await Promise.all([
    prisma.container.count({ where: { ownerId: userId } }),
    prisma.container.count({ where: { ownerId: userId, status: 'RUNNING' } }),
    prisma.auditLog.count({ where: { userId } }),
    prisma.auditLog.count({
      where: {
        userId,
        timestamp: { gte: thirtyDaysAgo },
      },
    }),
    prisma.cloudflareTunnel.count({
      where: {
        container: { ownerId: userId },
        status: 'ACTIVE',
      },
    }),
    prisma.userSession.count({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  // Get daily activity for the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dailyActivity = await prisma.auditLog.groupBy({
    by: ['timestamp'],
    where: {
      userId,
      timestamp: { gte: sevenDaysAgo },
    },
    _count: {
      id: true,
    },
  });

  // Process daily activity data
  const activityByDay = {};
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    activityByDay[dateKey] = 0;
  }

  dailyActivity.forEach(activity => {
    const dateKey = activity.timestamp.toISOString().split('T')[0];
    if (activityByDay.hasOwnProperty(dateKey)) {
      activityByDay[dateKey] = activity._count.id;
    }
  });

  sendSuccessResponse(res, {
    containers: {
      total: totalContainers,
      running: runningContainers,
      stopped: totalContainers - runningContainers,
    },
    activity: {
      totalLogs,
      recentLogs,
      dailyActivity: Object.entries(activityByDay).map(([date, count]) => ({
        date,
        count,
      })),
    },
    tunnels: {
      active: activeTunnels,
    },
    sessions: {
      active: activeSessions,
    },
    limits: {
      maxContainers: parseInt(process.env.MAX_CONTAINERS_PER_MEMBER) || 1,
      canCreateContainer: totalContainers < (parseInt(process.env.MAX_CONTAINERS_PER_MEMBER) || 1),
    },
  }, 'Statistics retrieved successfully');
}));

module.exports = router;
