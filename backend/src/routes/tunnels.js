const express = require('express');
const { body, param, validationResult } = require('express-validator');
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
const createTunnelValidation = [
  body('token')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Cloudflare tunnel token is required and must be at least 10 characters'),
  body('domain')
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage('Domain must be at least 3 characters')
    .matches(/^[a-zA-Z0-9.-]+$/)
    .withMessage('Invalid domain format'),
];

const updateTunnelValidation = [
  body('token')
    .optional()
    .trim()
    .isLength({ min: 10 })
    .withMessage('Cloudflare tunnel token must be at least 10 characters'),
  body('domain')
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage('Domain must be at least 3 characters')
    .matches(/^[a-zA-Z0-9.-]+$/)
    .withMessage('Invalid domain format'),
];

// Helper functions
const executeInContainer = async (containerId, command) => {
  try {
    const { exec, stream } = await containerManager.execCommand(containerId, command, {
      AttachStdout: true,
      AttachStderr: true,
    });

    return new Promise((resolve, reject) => {
      let output = '';
      let error = '';

      stream.on('data', (chunk) => {
        const data = chunk.toString();
        if (data.includes('stderr')) {
          error += data;
        } else {
          output += data;
        }
      });

      stream.on('end', async () => {
        try {
          const inspectResult = await exec.inspect();
          resolve({
            output: output.trim(),
            error: error.trim(),
            exitCode: inspectResult.ExitCode,
          });
        } catch (err) {
          reject(err);
        }
      });

      stream.on('error', reject);
    });
  } catch (error) {
    throw new Error('Failed to execute command in container');
  }
};

const installCloudflared = async (containerId) => {
  logger.info('Installing cloudflared in container', { containerId });

  // Check if cloudflared is already installed
  const checkCommand = 'which cloudflared';
  const checkResult = await executeInContainer(containerId, checkCommand);

  if (checkResult.exitCode === 0) {
    logger.info('Cloudflared already installed', { containerId });
    return true;
  }

  // Install cloudflared (for Alpine Linux)
  const installCommands = [
    'apk update',
    'apk add --no-cache curl',
    'curl -L --output cloudflared.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.tgz',
    'tar -xzf cloudflared.tgz',
    'mv cloudflared /usr/local/bin/',
    'chmod +x /usr/local/bin/cloudflared',
    'rm cloudflared.tgz',
  ];

  for (const command of installCommands) {
    const result = await executeInContainer(containerId, command);
    if (result.exitCode !== 0) {
      logger.error('Failed to install cloudflared', { 
        containerId, 
        command, 
        error: result.error 
      });
      throw new Error(`Failed to install cloudflared: ${result.error}`);
    }
  }

  logger.info('Cloudflared installed successfully', { containerId });
  return true;
};

const startTunnel = async (containerId, token, config = {}) => {
  logger.info('Starting Cloudflare tunnel', { containerId });

  // Create tunnel configuration
  const tunnelConfig = {
    'tunnel': token,
    'credentials-file': '/tmp/tunnel.json',
    'ingress': [
      {
        'hostname': config.domain || '*',
        'service': `http://localhost:${config.port || 3000}`,
      },
      {
        'service': 'http_status:404',
      },
    ],
  };

  // Write config file
  const configContent = JSON.stringify(tunnelConfig, null, 2);
  const writeConfigCommand = `echo '${configContent}' > /tmp/tunnel-config.yml`;
  await executeInContainer(containerId, writeConfigCommand);

  // Create credentials file (mock for PoC)
  const credentialsContent = JSON.stringify({
    AccountTag: 'mock-account',
    TunnelSecret: token,
    TunnelID: 'mock-tunnel-id',
  });
  const writeCredentialsCommand = `echo '${credentialsContent}' > /tmp/tunnel.json`;
  await executeInContainer(containerId, writeCredentialsCommand);

  // Start tunnel in background (mock implementation)
  const startCommand = 'nohup cloudflared tunnel --config /tmp/tunnel-config.yml run > /tmp/tunnel.log 2>&1 &';
  const startResult = await executeInContainer(containerId, startCommand);

  if (startResult.exitCode !== 0) {
    throw new Error(`Failed to start tunnel: ${startResult.error}`);
  }

  // For PoC, we'll simulate a successful tunnel with a mock domain
  const mockDomain = config.domain || `${containerId.substring(0, 8)}.trycloudflare.com`;
  
  logger.info('Cloudflare tunnel started (mock)', { 
    containerId, 
    domain: mockDomain 
  });

  return {
    domain: mockDomain,
    status: 'ACTIVE',
    ports: [config.port || 3000],
  };
};

const stopTunnel = async (containerId) => {
  logger.info('Stopping Cloudflare tunnel', { containerId });

  // Kill cloudflared processes
  const killCommand = 'pkill -f cloudflared || true';
  await executeInContainer(containerId, killCommand);

  // Clean up config files
  const cleanupCommand = 'rm -f /tmp/tunnel-config.yml /tmp/tunnel.json /tmp/tunnel.log';
  await executeInContainer(containerId, cleanupCommand);

  logger.info('Cloudflare tunnel stopped', { containerId });
};

const getTunnelStatus = async (containerId) => {
  try {
    // Check if cloudflared process is running
    const checkCommand = 'pgrep -f cloudflared';
    const checkResult = await executeInContainer(containerId, checkCommand);

    if (checkResult.exitCode === 0) {
      // Get tunnel logs for status
      const logCommand = 'tail -n 10 /tmp/tunnel.log 2>/dev/null || echo "No logs"';
      const logResult = await executeInContainer(containerId, logCommand);

      return {
        status: 'ACTIVE',
        logs: logResult.output,
        pid: checkResult.output.trim(),
      };
    } else {
      return {
        status: 'INACTIVE',
        logs: 'Tunnel not running',
        pid: null,
      };
    }
  } catch (error) {
    return {
      status: 'ERROR',
      logs: error.message,
      pid: null,
    };
  }
};

// Routes

// @desc    Get tunnels for container
// @route   GET /api/tunnels/:containerId
// @access  Private
router.get('/:containerId', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const prisma = getPrismaClient();

  const tunnels = await prisma.cloudflareTunnel.findMany({
    where: { containerId },
    orderBy: { createdAt: 'desc' },
  });

  // Get real-time status for each tunnel
  const tunnelsWithStatus = await Promise.all(
    tunnels.map(async (tunnel) => {
      const container = await prisma.container.findUnique({
        where: { id: containerId },
        select: { dockerId: true, status: true },
      });

      let realTimeStatus = tunnel.status;
      let statusInfo = null;

      if (container?.dockerId && container.status === 'RUNNING') {
        try {
          statusInfo = await getTunnelStatus(container.dockerId);
          realTimeStatus = statusInfo.status;
        } catch (error) {
          logger.debug('Failed to get tunnel status:', error.message);
        }
      }

      return {
        ...tunnel,
        status: realTimeStatus,
        statusInfo,
      };
    })
  );

  sendSuccessResponse(res, {
    tunnels: tunnelsWithStatus,
    containerId,
  }, 'Tunnels retrieved successfully');
}));

// @desc    Get tunnel by ID
// @route   GET /api/tunnels/:containerId/:tunnelId
// @access  Private
router.get('/:containerId/:tunnelId', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { containerId, tunnelId } = req.params;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
    include: {
      container: {
        select: {
          id: true,
          name: true,
          dockerId: true,
          status: true,
        },
      },
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  // Get real-time status
  let statusInfo = null;
  if (tunnel.container.dockerId && tunnel.container.status === 'RUNNING') {
    try {
      statusInfo = await getTunnelStatus(tunnel.container.dockerId);
    } catch (error) {
      logger.debug('Failed to get tunnel status:', error.message);
    }
  }

  sendSuccessResponse(res, {
    tunnel: {
      ...tunnel,
      statusInfo,
    },
  }, 'Tunnel retrieved successfully');
}));

// @desc    Create new tunnel
// @route   POST /api/tunnels/:containerId
// @access  Private
router.post('/:containerId', verifyToken, requireContainerOwnership, containerLimiter, createTunnelValidation, auditLog('TUNNEL_CREATE', 'TUNNEL'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { containerId } = req.params;
  const { token, domain, port = 3000 } = req.body;
  const prisma = getPrismaClient();

  // Get container info
  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: {
      id: true,
      name: true,
      dockerId: true,
      status: true,
      tunnels: true,
    },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  // Check if tunnel already exists for this container
  const existingTunnel = await prisma.cloudflareTunnel.findFirst({
    where: { containerId },
  });

  if (existingTunnel) {
    throw new ConflictError('Tunnel already exists for this container');
  }

  // Create tunnel record
  const tunnel = await prisma.cloudflareTunnel.create({
    data: {
      containerId,
      token,
      domain,
      status: 'INACTIVE',
      config: {
        port,
        autoStart: true,
      },
    },
  });

  logger.audit('Tunnel created', {
    userId: req.user.id,
    containerId,
    tunnelId: tunnel.id,
    domain,
    ip: req.ip,
  });

  sendSuccessResponse(res, { tunnel }, 'Tunnel created successfully', 201);
}));

// @desc    Update tunnel
// @route   PUT /api/tunnels/:containerId/:tunnelId
// @access  Private
router.put('/:containerId/:tunnelId', verifyToken, requireContainerOwnership, updateTunnelValidation, auditLog('TUNNEL_UPDATE', 'TUNNEL'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { containerId, tunnelId } = req.params;
  const { token, domain, port } = req.body;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  // Update tunnel
  const updateData = {};
  if (token) updateData.token = token;
  if (domain) updateData.domain = domain;
  if (port) {
    updateData.config = {
      ...tunnel.config,
      port,
    };
  }

  const updatedTunnel = await prisma.cloudflareTunnel.update({
    where: { id: tunnelId },
    data: updateData,
  });

  logger.audit('Tunnel updated', {
    userId: req.user.id,
    containerId,
    tunnelId,
    changes: updateData,
    ip: req.ip,
  });

  sendSuccessResponse(res, { tunnel: updatedTunnel }, 'Tunnel updated successfully');
}));

// @desc    Start tunnel
// @route   POST /api/tunnels/:containerId/:tunnelId/start
// @access  Private
router.post('/:containerId/:tunnelId/start', verifyToken, requireContainerOwnership, containerLimiter, auditLog('TUNNEL_START', 'TUNNEL'), asyncHandler(async (req, res) => {
  const { containerId, tunnelId } = req.params;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
    include: {
      container: {
        select: {
          dockerId: true,
          status: true,
        },
      },
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  if (!tunnel.container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  if (tunnel.container.status !== 'RUNNING') {
    throw new ValidationError('Container must be running to start tunnel');
  }

  try {
    // Install cloudflared if not already installed
    await installCloudflared(tunnel.container.dockerId);

    // Start tunnel
    const tunnelInfo = await startTunnel(tunnel.container.dockerId, tunnel.token, {
      domain: tunnel.domain,
      port: tunnel.config?.port || 3000,
    });

    // Update tunnel status
    const updatedTunnel = await prisma.cloudflareTunnel.update({
      where: { id: tunnelId },
      data: {
        status: 'ACTIVE',
        domain: tunnelInfo.domain,
        config: {
          ...tunnel.config,
          ports: tunnelInfo.ports,
          startedAt: new Date().toISOString(),
        },
      },
    });

    logger.audit('Tunnel started', {
      userId: req.user.id,
      containerId,
      tunnelId,
      domain: tunnelInfo.domain,
      ip: req.ip,
    });

    sendSuccessResponse(res, {
      tunnel: updatedTunnel,
      domain: tunnelInfo.domain,
      ports: tunnelInfo.ports,
    }, 'Tunnel started successfully');

  } catch (error) {
    // Update tunnel status to error
    await prisma.cloudflareTunnel.update({
      where: { id: tunnelId },
      data: {
        status: 'ERROR',
        config: {
          ...tunnel.config,
          lastError: error.message,
          errorAt: new Date().toISOString(),
        },
      },
    });

    logger.error('Failed to start tunnel:', error);
    throw new Error(`Failed to start tunnel: ${error.message}`);
  }
}));

// @desc    Stop tunnel
// @route   POST /api/tunnels/:containerId/:tunnelId/stop
// @access  Private
router.post('/:containerId/:tunnelId/stop', verifyToken, requireContainerOwnership, containerLimiter, auditLog('TUNNEL_STOP', 'TUNNEL'), asyncHandler(async (req, res) => {
  const { containerId, tunnelId } = req.params;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
    include: {
      container: {
        select: {
          dockerId: true,
          status: true,
        },
      },
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  if (!tunnel.container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  try {
    // Stop tunnel
    await stopTunnel(tunnel.container.dockerId);

    // Update tunnel status
    const updatedTunnel = await prisma.cloudflareTunnel.update({
      where: { id: tunnelId },
      data: {
        status: 'INACTIVE',
        config: {
          ...tunnel.config,
          stoppedAt: new Date().toISOString(),
        },
      },
    });

    logger.audit('Tunnel stopped', {
      userId: req.user.id,
      containerId,
      tunnelId,
      ip: req.ip,
    });

    sendSuccessResponse(res, { tunnel: updatedTunnel }, 'Tunnel stopped successfully');

  } catch (error) {
    logger.error('Failed to stop tunnel:', error);
    throw new Error(`Failed to stop tunnel: ${error.message}`);
  }
}));

// @desc    Delete tunnel
// @route   DELETE /api/tunnels/:containerId/:tunnelId
// @access  Private
router.delete('/:containerId/:tunnelId', verifyToken, requireContainerOwnership, auditLog('TUNNEL_DELETE', 'TUNNEL'), asyncHandler(async (req, res) => {
  const { containerId, tunnelId } = req.params;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
    include: {
      container: {
        select: {
          dockerId: true,
          status: true,
        },
      },
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  // Stop tunnel if it's running
  if (tunnel.status === 'ACTIVE' && tunnel.container.dockerId) {
    try {
      await stopTunnel(tunnel.container.dockerId);
    } catch (error) {
      logger.warn('Failed to stop tunnel during deletion:', error.message);
    }
  }

  // Delete tunnel from database
  await prisma.cloudflareTunnel.delete({
    where: { id: tunnelId },
  });

  logger.audit('Tunnel deleted', {
    userId: req.user.id,
    containerId,
    tunnelId,
    domain: tunnel.domain,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Tunnel deleted successfully');
}));

// @desc    Get tunnel logs
// @route   GET /api/tunnels/:containerId/:tunnelId/logs
// @access  Private
router.get('/:containerId/:tunnelId/logs', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { containerId, tunnelId } = req.params;
  const { lines = 50 } = req.query;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
    include: {
      container: {
        select: {
          dockerId: true,
          status: true,
        },
      },
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  let logs = 'No logs available';

  if (tunnel.container.dockerId) {
    try {
      const logCommand = `tail -n ${lines} /tmp/tunnel.log 2>/dev/null || echo "No logs available"`;
      const logResult = await executeInContainer(tunnel.container.dockerId, logCommand);
      logs = logResult.output || 'No logs available';
    } catch (error) {
      logger.debug('Failed to get tunnel logs:', error.message);
      logs = `Error retrieving logs: ${error.message}`;
    }
  }

  sendSuccessResponse(res, {
    tunnelId,
    containerId,
    logs,
    timestamp: new Date().toISOString(),
  }, 'Tunnel logs retrieved successfully');
}));

// @desc    Test tunnel connectivity
// @route   POST /api/tunnels/:containerId/:tunnelId/test
// @access  Private
router.post('/:containerId/:tunnelId/test', verifyToken, requireContainerOwnership, asyncHandler(async (req, res) => {
  const { containerId, tunnelId } = req.params;
  const prisma = getPrismaClient();

  const tunnel = await prisma.cloudflareTunnel.findFirst({
    where: {
      id: tunnelId,
      containerId,
    },
    include: {
      container: {
        select: {
          dockerId: true,
          status: true,
        },
      },
    },
  });

  if (!tunnel) {
    throw new NotFoundError('Tunnel not found');
  }

  if (!tunnel.container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  // Test tunnel connectivity (mock implementation for PoC)
  const testResults = {
    tunnelStatus: tunnel.status,
    containerStatus: tunnel.container.status,
    domain: tunnel.domain,
    accessible: tunnel.status === 'ACTIVE' && tunnel.container.status === 'RUNNING',
    lastChecked: new Date().toISOString(),
  };

  if (tunnel.container.status === 'RUNNING') {
    try {
      const statusInfo = await getTunnelStatus(tunnel.container.dockerId);
      testResults.processStatus = statusInfo.status;
      testResults.processId = statusInfo.pid;
    } catch (error) {
      testResults.error = error.message;
    }
  }

  sendSuccessResponse(res, {
    test: testResults,
  }, 'Tunnel connectivity test completed');
}));

module.exports = router;
