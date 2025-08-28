const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Import utilities
const logger = require('./utils/logger');
const { connectDatabase } = require('./utils/database');
const { connectRedis } = require('./utils/redis');
const { initializeDocker } = require('./utils/docker');

// Import middleware
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const memberRoutes = require('./routes/member');
const containerRoutes = require('./routes/containers');
const fileRoutes = require('./routes/files');
const tunnelRoutes = require('./routes/tunnels');
const healthRoutes = require('./routes/health');

// Import WebSocket handlers
const consoleHandler = require('./websocket/console');

const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Global middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
app.use('/api/', rateLimiter);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/member', memberRoutes);
app.use('/api/containers', containerRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/tunnels', tunnelRoutes);

// WebSocket handlers
consoleHandler(io);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
}

// Start server
async function startServer() {
  try {
    // Initialize connections
    await connectDatabase();
    await connectRedis();
    await initializeDocker();

    const PORT = process.env.PORT || 5000;
    
    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      logger.info(`🐳 Docker socket: ${process.env.DOCKER_SOCKET || '/var/run/docker.sock'}`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();

module.exports = { app, server, io };
