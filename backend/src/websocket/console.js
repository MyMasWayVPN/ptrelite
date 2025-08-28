const { getPrismaClient } = require('../utils/database');
const { getDockerClient, ContainerManager } = require('../utils/docker');
const { extractToken } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Initialize container manager
let containerManager;
try {
  const docker = getDockerClient();
  containerManager = new ContainerManager(docker);
} catch (error) {
  logger.error('Failed to initialize container manager for WebSocket:', error);
}

// Active console sessions
const activeSessions = new Map();

// Console session class
class ConsoleSession {
  constructor(socket, containerId, userId) {
    this.socket = socket;
    this.containerId = containerId;
    this.userId = userId;
    this.dockerExec = null;
    this.stream = null;
    this.isActive = false;
    this.startTime = Date.now();
    this.commandHistory = [];
  }

  async start() {
    try {
      const prisma = getPrismaClient();
      
      // Get container info
      const container = await prisma.container.findUnique({
        where: { id: this.containerId },
        select: {
          dockerId: true,
          status: true,
          ownerId: true,
        },
      });

      if (!container) {
        throw new Error('Container not found');
      }

      // Check ownership (admin can access all containers)
      const user = await prisma.user.findUnique({
        where: { id: this.userId },
        select: { role: true },
      });

      if (user.role !== 'ADMIN' && container.ownerId !== this.userId) {
        throw new Error('Access denied to this container');
      }

      if (!container.dockerId) {
        throw new Error('Container has no Docker ID');
      }

      if (container.status !== 'RUNNING') {
        throw new Error('Container is not running');
      }

      // Create exec instance for interactive shell
      const { exec, stream } = await containerManager.execCommand(container.dockerId, ['/bin/sh'], {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });

      this.dockerExec = exec;
      this.stream = stream;
      this.isActive = true;

      // Handle stream data
      this.stream.on('data', (chunk) => {
        const data = chunk.toString();
        this.socket.emit('console:output', {
          data,
          timestamp: Date.now(),
        });
      });

      this.stream.on('error', (error) => {
        logger.error('Console stream error:', error);
        this.socket.emit('console:error', {
          message: 'Stream error occurred',
          error: error.message,
        });
        this.cleanup();
      });

      this.stream.on('end', () => {
        logger.info('Console stream ended', { 
          containerId: this.containerId, 
          userId: this.userId 
        });
        this.socket.emit('console:disconnected', {
          message: 'Console session ended',
        });
        this.cleanup();
      });

      // Send initial prompt
      this.socket.emit('console:connected', {
        message: 'Console connected successfully',
        containerId: this.containerId,
        timestamp: Date.now(),
      });

      // Log console connection
      await prisma.containerLog.create({
        data: {
          containerId: this.containerId,
          command: 'CONSOLE_CONNECT',
          output: 'Console session started',
          exitCode: 0,
        },
      });

      logger.audit('Console session started', {
        userId: this.userId,
        containerId: this.containerId,
        sessionId: this.socket.id,
      });

    } catch (error) {
      logger.error('Failed to start console session:', error);
      this.socket.emit('console:error', {
        message: 'Failed to start console session',
        error: error.message,
      });
      this.cleanup();
    }
  }

  async sendCommand(command) {
    if (!this.isActive || !this.stream) {
      this.socket.emit('console:error', {
        message: 'Console session not active',
      });
      return;
    }

    try {
      // Add to command history
      this.commandHistory.push({
        command,
        timestamp: Date.now(),
      });

      // Keep only last 100 commands
      if (this.commandHistory.length > 100) {
        this.commandHistory = this.commandHistory.slice(-100);
      }

      // Send command to container
      this.stream.write(command + '\n');

      // Log command execution
      const prisma = getPrismaClient();
      await prisma.containerLog.create({
        data: {
          containerId: this.containerId,
          command: command.substring(0, 1000), // Limit command length
          output: null, // Output will be captured separately
          exitCode: null,
        },
      });

      logger.audit('Console command executed', {
        userId: this.userId,
        containerId: this.containerId,
        command: command.substring(0, 100), // Log first 100 chars
        sessionId: this.socket.id,
      });

    } catch (error) {
      logger.error('Failed to send command:', error);
      this.socket.emit('console:error', {
        message: 'Failed to send command',
        error: error.message,
      });
    }
  }

  async sendInput(input) {
    if (!this.isActive || !this.stream) {
      return;
    }

    try {
      this.stream.write(input);
    } catch (error) {
      logger.error('Failed to send input:', error);
      this.socket.emit('console:error', {
        message: 'Failed to send input',
        error: error.message,
      });
    }
  }

  async resize(cols, rows) {
    if (!this.isActive || !this.dockerExec) {
      return;
    }

    try {
      await this.dockerExec.resize({
        h: rows,
        w: cols,
      });
    } catch (error) {
      logger.error('Failed to resize console:', error);
    }
  }

  getStats() {
    return {
      containerId: this.containerId,
      userId: this.userId,
      isActive: this.isActive,
      startTime: this.startTime,
      uptime: Date.now() - this.startTime,
      commandCount: this.commandHistory.length,
      lastCommand: this.commandHistory[this.commandHistory.length - 1],
    };
  }

  async cleanup() {
    this.isActive = false;

    if (this.stream) {
      try {
        this.stream.destroy();
      } catch (error) {
        logger.error('Error destroying stream:', error);
      }
      this.stream = null;
    }

    this.dockerExec = null;

    // Remove from active sessions
    activeSessions.delete(this.socket.id);

    // Log session end
    try {
      const prisma = getPrismaClient();
      await prisma.containerLog.create({
        data: {
          containerId: this.containerId,
          command: 'CONSOLE_DISCONNECT',
          output: `Console session ended. Duration: ${Date.now() - this.startTime}ms`,
          exitCode: 0,
        },
      });

      logger.audit('Console session ended', {
        userId: this.userId,
        containerId: this.containerId,
        sessionId: this.socket.id,
        duration: Date.now() - this.startTime,
        commandCount: this.commandHistory.length,
      });
    } catch (error) {
      logger.error('Failed to log console session end:', error);
    }
  }
}

// WebSocket authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return next(new Error('User not found or inactive'));
    }

    socket.user = user;
    next();
  } catch (error) {
    logger.error('Socket authentication failed:', error);
    next(new Error('Authentication failed'));
  }
};

// Main WebSocket handler
const consoleHandler = (io) => {
  // Console namespace
  const consoleNamespace = io.of('/console');
  
  // Authentication middleware
  consoleNamespace.use(authenticateSocket);

  consoleNamespace.on('connection', (socket) => {
    logger.info('Console WebSocket connected', {
      socketId: socket.id,
      userId: socket.user.id,
      username: socket.user.username,
    });

    // Handle console connection request
    socket.on('console:connect', async (data) => {
      try {
        const { containerId } = data;

        if (!containerId) {
          socket.emit('console:error', {
            message: 'Container ID is required',
          });
          return;
        }

        // Check if session already exists
        if (activeSessions.has(socket.id)) {
          socket.emit('console:error', {
            message: 'Console session already active',
          });
          return;
        }

        // Create new console session
        const session = new ConsoleSession(socket, containerId, socket.user.id);
        activeSessions.set(socket.id, session);

        // Start the session
        await session.start();

      } catch (error) {
        logger.error('Console connect error:', error);
        socket.emit('console:error', {
          message: 'Failed to connect to console',
          error: error.message,
        });
      }
    });

    // Handle command input
    socket.on('console:command', async (data) => {
      const session = activeSessions.get(socket.id);
      if (!session) {
        socket.emit('console:error', {
          message: 'No active console session',
        });
        return;
      }

      const { command } = data;
      if (typeof command === 'string') {
        await session.sendCommand(command);
      }
    });

    // Handle raw input (for interactive commands)
    socket.on('console:input', async (data) => {
      const session = activeSessions.get(socket.id);
      if (!session) {
        return;
      }

      const { input } = data;
      if (typeof input === 'string') {
        await session.sendInput(input);
      }
    });

    // Handle terminal resize
    socket.on('console:resize', async (data) => {
      const session = activeSessions.get(socket.id);
      if (!session) {
        return;
      }

      const { cols, rows } = data;
      if (typeof cols === 'number' && typeof rows === 'number') {
        await session.resize(cols, rows);
      }
    });

    // Handle stats request
    socket.on('console:stats', () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        socket.emit('console:stats', session.getStats());
      } else {
        socket.emit('console:stats', null);
      }
    });

    // Handle disconnect
    socket.on('console:disconnect', async () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        await session.cleanup();
      }
    });

    // Handle socket disconnect
    socket.on('disconnect', async (reason) => {
      logger.info('Console WebSocket disconnected', {
        socketId: socket.id,
        userId: socket.user.id,
        reason,
      });

      const session = activeSessions.get(socket.id);
      if (session) {
        await session.cleanup();
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('Console WebSocket error:', error);
      const session = activeSessions.get(socket.id);
      if (session) {
        session.cleanup();
      }
    });
  });

  // Stats namespace for real-time container stats
  const statsNamespace = io.of('/stats');
  
  statsNamespace.use(authenticateSocket);

  statsNamespace.on('connection', (socket) => {
    logger.info('Stats WebSocket connected', {
      socketId: socket.id,
      userId: socket.user.id,
    });

    let statsInterval = null;

    // Handle stats subscription
    socket.on('stats:subscribe', async (data) => {
      try {
        const { containerId, interval = 2000 } = data;

        if (!containerId) {
          socket.emit('stats:error', {
            message: 'Container ID is required',
          });
          return;
        }

        // Verify container access
        const prisma = getPrismaClient();
        const container = await prisma.container.findUnique({
          where: { id: containerId },
          select: {
            dockerId: true,
            status: true,
            ownerId: true,
          },
        });

        if (!container) {
          socket.emit('stats:error', {
            message: 'Container not found',
          });
          return;
        }

        // Check ownership
        if (socket.user.role !== 'ADMIN' && container.ownerId !== socket.user.id) {
          socket.emit('stats:error', {
            message: 'Access denied to this container',
          });
          return;
        }

        if (!container.dockerId || container.status !== 'RUNNING') {
          socket.emit('stats:error', {
            message: 'Container is not running',
          });
          return;
        }

        // Clear existing interval
        if (statsInterval) {
          clearInterval(statsInterval);
        }

        // Start sending stats
        statsInterval = setInterval(async () => {
          try {
            const stats = await containerManager.getContainerStats(container.dockerId);
            socket.emit('stats:data', {
              containerId,
              stats,
              timestamp: Date.now(),
            });
          } catch (error) {
            logger.error('Failed to get container stats:', error);
            socket.emit('stats:error', {
              message: 'Failed to get container stats',
              error: error.message,
            });
          }
        }, Math.max(1000, Math.min(10000, interval))); // Limit between 1-10 seconds

        socket.emit('stats:subscribed', {
          containerId,
          interval,
        });

      } catch (error) {
        logger.error('Stats subscribe error:', error);
        socket.emit('stats:error', {
          message: 'Failed to subscribe to stats',
          error: error.message,
        });
      }
    });

    // Handle unsubscribe
    socket.on('stats:unsubscribe', () => {
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
      socket.emit('stats:unsubscribed');
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      if (statsInterval) {
        clearInterval(statsInterval);
      }
    });
  });

  // Cleanup function for graceful shutdown
  const cleanup = () => {
    logger.info('Cleaning up WebSocket sessions...');
    
    // Cleanup all active console sessions
    for (const [socketId, session] of activeSessions) {
      session.cleanup();
    }
    
    activeSessions.clear();
  };

  // Export cleanup function
  consoleHandler.cleanup = cleanup;

  return consoleHandler;
};

module.exports = consoleHandler;
