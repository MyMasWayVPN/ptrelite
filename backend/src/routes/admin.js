const express = require('express');
const bcrypt = require('bcryptjs');
const { body, query, validationResult } = require('express-validator');
const { getPrismaClient } = require('../utils/database');
const { getDockerClient, ContainerManager } = require('../utils/docker');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimiter');
const { asyncHandler, sendSuccessResponse, ValidationError, NotFoundError, ConflictError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// All admin routes require admin role
router.use(verifyToken, requireAdmin);

// Initialize container manager
let containerManager;
try {
  const docker = getDockerClient();
  containerManager = new ContainerManager(docker);
} catch (error) {
  logger.error('Failed to initialize container manager:', error);
}

// Validation rules
const createUserValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  body('role')
    .isIn(['ADMIN', 'MEMBER'])
    .withMessage('Role must be either ADMIN or MEMBER'),
];

const updateUserValidation = [
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
  body('role')
    .optional()
    .isIn(['ADMIN', 'MEMBER'])
    .withMessage('Role must be either ADMIN or MEMBER'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
];

const resetPasswordValidation = [
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number'),
];

// User Management Routes

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
router.get('/users', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search, isActive } = req.query;
  const prisma = getPrismaClient();

  // Build where clause
  const where = {};
  if (role) {
    where.role = role.toUpperCase();
  }
  if (search) {
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  // Get users with pagination
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit),
    }),
    prisma.user.count({ where }),
  ]);

  sendSuccessResponse(res, {
    users,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  }, 'Users retrieved successfully');
}));

// @desc    Get user by ID
// @route   GET /api/admin/users/:id
// @access  Private/Admin
router.get('/users/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      containers: {
        select: {
          id: true,
          name: true,
          image: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      sessions: {
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      logs: {
        select: {
          id: true,
          action: true,
          resource: true,
          timestamp: true,
          ipAddress: true,
        },
        orderBy: { timestamp: 'desc' },
        take: 20,
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  sendSuccessResponse(res, { user }, 'User retrieved successfully');
}));

// @desc    Create new user
// @route   POST /api/admin/users
// @access  Private/Admin
router.post('/users', strictLimiter, createUserValidation, auditLog('USER_CREATE', 'USER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { username, email, password, role = 'MEMBER' } = req.body;
  const prisma = getPrismaClient();

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        { email },
      ],
    },
  });

  if (existingUser) {
    throw new ConflictError('User with this username or email already exists');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

  // Create user
  const user = await prisma.user.create({
    data: {
      username,
      email,
      password: hashedPassword,
      role: role.toUpperCase(),
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  logger.audit('User created by admin', {
    adminId: req.user.id,
    newUserId: user.id,
    username: user.username,
    role: user.role,
    ip: req.ip,
  });

  sendSuccessResponse(res, { user }, 'User created successfully', 201);
}));

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
router.put('/users/:id', updateUserValidation, auditLog('USER_UPDATE', 'USER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { id } = req.params;
  const { username, email, role, isActive } = req.body;
  const prisma = getPrismaClient();

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    throw new NotFoundError('User not found');
  }

  // Prevent admin from deactivating themselves
  if (id === req.user.id && isActive === false) {
    throw new ValidationError('You cannot deactivate your own account');
  }

  // Check for username/email conflicts
  if (username || email) {
    const conflictUser = await prisma.user.findFirst({
      where: {
        AND: [
          { id: { not: id } },
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

  // Update user
  const updateData = {};
  if (username) updateData.username = username;
  if (email) updateData.email = email;
  if (role) updateData.role = role.toUpperCase();
  if (isActive !== undefined) updateData.isActive = isActive;

  const user = await prisma.user.update({
    where: { id },
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

  // If user is deactivated, remove all their sessions
  if (isActive === false) {
    await prisma.userSession.deleteMany({
      where: { userId: id },
    });
  }

  logger.audit('User updated by admin', {
    adminId: req.user.id,
    targetUserId: id,
    changes: updateData,
    ip: req.ip,
  });

  sendSuccessResponse(res, { user }, 'User updated successfully');
}));

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
router.delete('/users/:id', auditLog('USER_DELETE', 'USER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();

  // Prevent admin from deleting themselves
  if (id === req.user.id) {
    throw new ValidationError('You cannot delete your own account');
  }

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      containers: true,
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Remove user's containers from Docker
  for (const container of user.containers) {
    if (container.dockerId) {
      try {
        await containerManager.removeContainer(container.dockerId, true);
      } catch (error) {
        logger.warn('Failed to remove Docker container:', error.message);
      }
    }
  }

  // Delete user (cascade will handle related records)
  await prisma.user.delete({
    where: { id },
  });

  logger.audit('User deleted by admin', {
    adminId: req.user.id,
    deletedUserId: id,
    deletedUsername: user.username,
    containersRemoved: user.containers.length,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'User deleted successfully');
}));

// @desc    Reset user password
// @route   POST /api/admin/users/:id/reset-password
// @access  Private/Admin
router.post('/users/:id/reset-password', strictLimiter, resetPasswordValidation, auditLog('PASSWORD_RESET', 'USER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { id } = req.params;
  const { newPassword } = req.body;
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

  // Update password
  await prisma.user.update({
    where: { id },
    data: { password: hashedPassword },
  });

  // Invalidate all user sessions
  await prisma.userSession.deleteMany({
    where: { userId: id },
  });

  logger.audit('Password reset by admin', {
    adminId: req.user.id,
    targetUserId: id,
    targetUsername: user.username,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Password reset successfully');
}));

// Container Management Routes

// @desc    Get all containers (admin view)
// @route   GET /api/admin/containers
// @access  Private/Admin
router.get('/containers', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, ownerId, search } = req.query;
  const prisma = getPrismaClient();

  // Build where clause
  const where = {};
  if (status) {
    where.status = status.toUpperCase();
  }
  if (ownerId) {
    where.ownerId = ownerId;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { image: { contains: search, mode: 'insensitive' } },
      { owner: { username: { contains: search, mode: 'insensitive' } } },
    ];
  }

  // Get containers with pagination
  const [containers, total] = await Promise.all([
    prisma.container.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
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
      skip: (page - 1) * limit,
      take: parseInt(limit),
    }),
    prisma.container.count({ where }),
  ]);

  sendSuccessResponse(res, {
    containers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  }, 'Containers retrieved successfully');
}));

// @desc    Force delete container
// @route   DELETE /api/admin/containers/:id
// @access  Private/Admin
router.delete('/containers/:id', auditLog('CONTAINER_FORCE_DELETE', 'CONTAINER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  // Remove Docker container if exists
  if (container.dockerId) {
    try {
      await containerManager.removeContainer(container.dockerId, true);
    } catch (error) {
      logger.warn('Failed to remove Docker container:', error.message);
    }
  }

  // Remove from database
  await prisma.container.delete({
    where: { id },
  });

  logger.audit('Container force deleted by admin', {
    adminId: req.user.id,
    containerId: id,
    containerName: container.name,
    ownerId: container.ownerId,
    ownerUsername: container.owner.username,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Container deleted successfully');
}));

// System Management Routes

// @desc    Get system statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
router.get('/stats', asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();

  // Get database stats
  const [
    totalUsers,
    activeUsers,
    totalContainers,
    runningContainers,
    totalLogs,
    recentLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.container.count(),
    prisma.container.count({ where: { status: 'RUNNING' } }),
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      take: 10,
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    }),
  ]);

  // Get Docker stats
  let dockerStats = null;
  try {
    const docker = getDockerClient();
    const dockerInfo = await docker.info();
    dockerStats = {
      containers: dockerInfo.Containers,
      containersRunning: dockerInfo.ContainersRunning,
      containersPaused: dockerInfo.ContainersPaused,
      containersStopped: dockerInfo.ContainersStopped,
      images: dockerInfo.Images,
      serverVersion: dockerInfo.ServerVersion,
      memTotal: Math.round(dockerInfo.MemTotal / 1024 / 1024 / 1024), // GB
      cpus: dockerInfo.NCPU,
    };
  } catch (error) {
    logger.error('Failed to get Docker stats:', error);
  }

  // System stats
  const systemStats = {
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  };

  sendSuccessResponse(res, {
    users: {
      total: totalUsers,
      active: activeUsers,
      inactive: totalUsers - activeUsers,
    },
    containers: {
      total: totalContainers,
      running: runningContainers,
      stopped: totalContainers - runningContainers,
    },
    logs: {
      total: totalLogs,
      recent: recentLogs,
    },
    docker: dockerStats,
    system: systemStats,
  }, 'System statistics retrieved successfully');
}));

// @desc    Get audit logs
// @route   GET /api/admin/logs
// @access  Private/Admin
router.get('/logs', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, userId, action, resource, startDate, endDate } = req.query;
  const prisma = getPrismaClient();

  // Build where clause
  const where = {};
  if (userId) {
    where.userId = userId;
  }
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
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
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
  }, 'Audit logs retrieved successfully');
}));

// @desc    Get system settings
// @route   GET /api/admin/settings
// @access  Private/Admin
router.get('/settings', asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();

  const settings = await prisma.systemSetting.findMany({
    orderBy: { key: 'asc' },
  });

  const settingsObject = settings.reduce((acc, setting) => {
    acc[setting.key] = setting.value;
    return acc;
  }, {});

  sendSuccessResponse(res, { settings: settingsObject }, 'System settings retrieved successfully');
}));

// @desc    Update system setting
// @route   PUT /api/admin/settings/:key
// @access  Private/Admin
router.put('/settings/:key', auditLog('SETTING_UPDATE', 'SYSTEM'), asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  const prisma = getPrismaClient();

  if (!value) {
    throw new ValidationError('Value is required');
  }

  const setting = await prisma.systemSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });

  logger.audit('System setting updated', {
    adminId: req.user.id,
    settingKey: key,
    newValue: value,
    ip: req.ip,
  });

  sendSuccessResponse(res, { setting }, 'System setting updated successfully');
}));

module.exports = router;
