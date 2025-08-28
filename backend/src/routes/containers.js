const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { getPrismaClient } = require('../utils/database');
const { getDockerClient, ContainerManager } = require('../utils/docker');
const { verifyToken, requireContainerOwnership, auditLog } = require('../middleware/auth');
const { containerLimiter } = require('../middleware/rateLimiter');
const { asyncHandler, sendSuccessResponse, ValidationError, NotFoundError, ConflictError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize container manager
let containerManager;
try {
  const docker = getDockerClient();
  containerManager = new ContainerManager(docker);
} catch (error) {
  logger.error('Failed to initialize container manager:', error);
}

// Validation rules
const createContainerValidation = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Container name must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Container name can only contain letters, numbers, underscores, and hyphens'),
  body('image')
    .trim()
    .notEmpty()
    .withMessage('Docker image is required')
    .matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127})?$/)
    .withMessage('Invalid Docker image format'),
  body('resources.memory')
    .optional()
    .matches(/^\d+[kmg]?$/i)
    .withMessage('Memory must be in format like 512m, 1g, etc.'),
  body('resources.cpus')
    .optional()
    .isFloat({ min: 0.1, max: 8 })
    .withMessage('CPU limit must be between 0.1 and 8'),
];

const updateContainerValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Container name must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Container name can only contain letters, numbers, underscores, and hyphens'),
];

// Helper functions
const checkContainerLimit = async (userId, userRole) => {
  if (userRole === 'ADMIN') return true;

  const prisma = getPrismaClient();
  const containerCount = await prisma.container.count({
    where: { ownerId: userId },
  });

  const maxContainers = parseInt(process.env.MAX_CONTAINERS_PER_MEMBER) || 1;
  return containerCount < maxContainers;
};

const getAllowedImages = () => {
  try {
    const allowedImages = JSON.parse(process.env.ALLOWED_IMAGES || '[]');
    return allowedImages.length > 0 ? allowedImages : [
      'node:18-alpine',
      'node:16-alpine',
      'python:3.11-alpine',
      'python:3.9-alpine',
      'nginx:alpine',
      'ubuntu:22.04',
    ];
  } catch (error) {
    logger.error('Error parsing allowed images:', error);
    return ['node:18-alpine', 'python:3.11-alpine'];
  }
};

const syncContainerStatus = async (containerId) => {
  try {
    const containerInfo = await containerManager.getContainerInfo(containerId);
    const status = containerInfo.State.Status.toUpperCase();
    
    const prisma = getPrismaClient();
    await prisma.container.update({
      where: { dockerId: containerId },
      data: { status },
    });

    return status;
  } catch (error) {
    logger.error('Failed to sync container status:', error);
    return null;
  }
};

// Routes

// @desc    Get all containers (filtered by user role)
// @route   GET /api/containers
// @access  Private
router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search } = req.query;
  const prisma = getPrismaClient();

  // Build where clause based on user role
  const where = {};
  if (req.user.role === 'MEMBER') {
    where.ownerId = req.user.id;
  }

  if (status) {
    where.status = status.toUpperCase();
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { image: { contains: search, mode: 'insensitive' } },
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
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit),
    }),
    prisma.container.count({ where }),
  ]);

  // Sync container statuses with Docker
  const containersWithStats = await Promise.all(
    containers.map(async (container) => {
      let stats = null;
      let dockerStatus = container.status;

      if (container.dockerId) {
        try {
          // Get real-time stats
          stats = await containerManager.getContainerStats(container.dockerId);
          // Sync status
          dockerStatus = await syncContainerStatus(container.dockerId) || container.status;
        } catch (error) {
          logger.debug('Failed to get container stats:', error.message);
        }
      }

      return {
        ...container,
        status: dockerStatus,
        stats,
      };
    })
  );

  sendSuccessResponse(res, {
    containers: containersWithStats,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  }, 'Containers retrieved successfully');
}));

// @desc    Get container by ID
// @route   GET /api/containers/:id
// @access  Private
router.get('/:id', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
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

  // Get real-time info and stats
  let dockerInfo = null;
  let stats = null;

  if (container.dockerId) {
    try {
      dockerInfo = await containerManager.getContainerInfo(container.dockerId);
      stats = await containerManager.getContainerStats(container.dockerId);
      
      // Sync status
      const dockerStatus = await syncContainerStatus(container.dockerId);
      if (dockerStatus) {
        container.status = dockerStatus;
      }
    } catch (error) {
      logger.debug('Failed to get container info:', error.message);
    }
  }

  sendSuccessResponse(res, {
    container: {
      ...container,
      dockerInfo,
      stats,
    },
  }, 'Container retrieved successfully');
}));

// @desc    Create new container
// @route   POST /api/containers
// @access  Private
router.post('/', verifyToken, containerLimiter, createContainerValidation, auditLog('CONTAINER_CREATE', 'CONTAINER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { name, image, cmd = [], env = {}, ports = [], resources = {} } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Check container limit for members
  const canCreateContainer = await checkContainerLimit(userId, userRole);
  if (!canCreateContainer) {
    throw new ConflictError('Container limit reached. Members can only have 1 active container.');
  }

  // Check if image is allowed
  const allowedImages = getAllowedImages();
  const imageWithoutTag = image.split(':')[0];
  const isImageAllowed = allowedImages.some(allowed => 
    allowed === image || allowed.split(':')[0] === imageWithoutTag
  );

  if (!isImageAllowed && userRole !== 'ADMIN') {
    throw new ValidationError(`Image ${image} is not allowed. Allowed images: ${allowedImages.join(', ')}`);
  }

  const prisma = getPrismaClient();

  // Check if container name already exists for user
  const existingContainer = await prisma.container.findFirst({
    where: {
      name,
      ownerId: userId,
    },
  });

  if (existingContainer) {
    throw new ConflictError('Container with this name already exists');
  }

  try {
    // Create container in database first
    const container = await prisma.container.create({
      data: {
        name,
        image,
        ownerId: userId,
        status: 'CREATED',
        config: {
          cmd,
          env,
          ports,
        },
        resources: {
          memory: resources.memory || process.env.DEFAULT_CONTAINER_MEMORY || '512m',
          cpus: resources.cpus || parseFloat(process.env.DEFAULT_CONTAINER_CPU) || 0.5,
        },
        ports: ports.map(port => ({
          containerPort: port.containerPort || 3000,
          protocol: port.protocol || 'tcp',
        })),
        environment: env,
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    // Create Docker container
    const dockerContainer = await containerManager.createContainer({
      name: `panel_${container.id}`,
      image,
      cmd,
      env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      ports: ports.reduce((acc, port) => {
        acc[`${port.containerPort}/${port.protocol || 'tcp'}`] = {};
        return acc;
      }, {}),
      memory: resources.memory || '512m',
      cpus: resources.cpus || 0.5,
      labels: {
        'panel.container.id': container.id,
        'panel.owner.id': userId,
        'panel.owner.username': req.user.username,
      },
    });

    // Update container with Docker ID
    const updatedContainer = await prisma.container.update({
      where: { id: container.id },
      data: {
        dockerId: dockerContainer.id,
        status: 'CREATED',
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    logger.info('Container created successfully', {
      containerId: container.id,
      dockerId: dockerContainer.id,
      name,
      image,
      userId,
    });

    sendSuccessResponse(res, { container: updatedContainer }, 'Container created successfully', 201);
  } catch (error) {
    // Clean up database record if Docker creation failed
    try {
      await prisma.container.delete({ where: { id: container?.id } });
    } catch (cleanupError) {
      logger.error('Failed to cleanup container record:', cleanupError);
    }
    throw error;
  }
}));

// @desc    Update container
// @route   PUT /api/containers/:id
// @access  Private
router.put('/:id', verifyToken, requireContainerOwnership, updateContainerValidation, auditLog('CONTAINER_UPDATE', 'CONTAINER'), asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { id } = req.params;
  const { name } = req.body;
  const prisma = getPrismaClient();

  // Check if new name conflicts
  if (name) {
    const existingContainer = await prisma.container.findFirst({
      where: {
        name,
        ownerId: req.user.id,
        id: { not: id },
      },
    });

    if (existingContainer) {
      throw new ConflictError('Container with this name already exists');
    }
  }

  const container = await prisma.container.update({
    where: { id },
    data: { name },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
    },
  });

  sendSuccessResponse(res, { container }, 'Container updated successfully');
}));

// @desc    Start container
// @route   POST /api/containers/:id/start
// @access  Private
router.post('/:id/start', verifyToken, requireContainerOwnership, containerLimiter, auditLog('CONTAINER_START', 'CONTAINER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  if (!container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  await containerManager.startContainer(container.dockerId);

  // Update status
  await prisma.container.update({
    where: { id },
    data: { status: 'RUNNING' },
  });

  // Log container action
  await prisma.containerLog.create({
    data: {
      containerId: id,
      command: 'START',
      output: 'Container started successfully',
      exitCode: 0,
    },
  });

  sendSuccessResponse(res, null, 'Container started successfully');
}));

// @desc    Stop container
// @route   POST /api/containers/:id/stop
// @access  Private
router.post('/:id/stop', verifyToken, requireContainerOwnership, containerLimiter, auditLog('CONTAINER_STOP', 'CONTAINER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { timeout = 10 } = req.body;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  if (!container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  await containerManager.stopContainer(container.dockerId, timeout);

  // Update status
  await prisma.container.update({
    where: { id },
    data: { status: 'STOPPED' },
  });

  // Log container action
  await prisma.containerLog.create({
    data: {
      containerId: id,
      command: 'STOP',
      output: `Container stopped successfully (timeout: ${timeout}s)`,
      exitCode: 0,
    },
  });

  sendSuccessResponse(res, null, 'Container stopped successfully');
}));

// @desc    Restart container
// @route   POST /api/containers/:id/restart
// @access  Private
router.post('/:id/restart', verifyToken, requireContainerOwnership, containerLimiter, auditLog('CONTAINER_RESTART', 'CONTAINER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { timeout = 10 } = req.body;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  if (!container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  await containerManager.restartContainer(container.dockerId, timeout);

  // Update status
  await prisma.container.update({
    where: { id },
    data: { status: 'RUNNING' },
  });

  // Log container action
  await prisma.containerLog.create({
    data: {
      containerId: id,
      command: 'RESTART',
      output: `Container restarted successfully (timeout: ${timeout}s)`,
      exitCode: 0,
    },
  });

  sendSuccessResponse(res, null, 'Container restarted successfully');
}));

// @desc    Delete container
// @route   DELETE /api/containers/:id
// @access  Private
router.delete('/:id', verifyToken, requireContainerOwnership, auditLog('CONTAINER_DELETE', 'CONTAINER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { force = false } = req.query;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  // Remove Docker container if exists
  if (container.dockerId) {
    try {
      await containerManager.removeContainer(container.dockerId, force);
    } catch (error) {
      logger.warn('Failed to remove Docker container:', error.message);
    }
  }

  // Remove from database
  await prisma.container.delete({
    where: { id },
  });

  sendSuccessResponse(res, null, 'Container deleted successfully');
}));

// @desc    Get container stats
// @route   GET /api/containers/:id/stats
// @access  Private
router.get('/:id/stats', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id },
    select: { dockerId: true },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  if (!container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  const stats = await containerManager.getContainerStats(container.dockerId);

  sendSuccessResponse(res, { stats }, 'Container stats retrieved successfully');
}));

// @desc    Get container logs
// @route   GET /api/containers/:id/logs
// @access  Private
router.get('/:id/logs', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { limit = 100 } = req.query;
  const prisma = getPrismaClient();

  const logs = await prisma.containerLog.findMany({
    where: { containerId: id },
    orderBy: { timestamp: 'desc' },
    take: parseInt(limit),
  });

  sendSuccessResponse(res, { logs }, 'Container logs retrieved successfully');
}));

// @desc    Get allowed images
// @route   GET /api/containers/images/allowed
// @access  Private
router.get('/images/allowed', verifyToken, asyncHandler(async (req, res) => {
  const allowedImages = getAllowedImages();
  
  sendSuccessResponse(res, { images: allowedImages }, 'Allowed images retrieved successfully');
}));

module.exports = router;
