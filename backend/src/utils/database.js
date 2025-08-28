const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

let prisma;

// Initialize Prisma client with configuration
function createPrismaClient() {
  return new PrismaClient({
    log: [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'info',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
    errorFormat: 'pretty',
  });
}

// Connect to database
async function connectDatabase() {
  try {
    if (!prisma) {
      prisma = createPrismaClient();

      // Log database events
      prisma.$on('query', (e) => {
        if (process.env.NODE_ENV === 'development') {
          logger.debug('Database Query:', {
            query: e.query,
            params: e.params,
            duration: `${e.duration}ms`,
          });
        }
      });

      prisma.$on('error', (e) => {
        logger.error('Database Error:', e);
      });

      prisma.$on('info', (e) => {
        logger.info('Database Info:', e.message);
      });

      prisma.$on('warn', (e) => {
        logger.warn('Database Warning:', e.message);
      });

      // Test connection
      await prisma.$connect();
      logger.info('✅ Database connected successfully');

      // Check if database is properly migrated
      try {
        await prisma.user.findFirst();
        logger.info('✅ Database schema verified');
      } catch (error) {
        logger.warn('⚠️ Database schema might need migration:', error.message);
      }
    }

    return prisma;
  } catch (error) {
    logger.error('❌ Failed to connect to database:', error);
    throw error;
  }
}

// Disconnect from database
async function disconnectDatabase() {
  try {
    if (prisma) {
      await prisma.$disconnect();
      logger.info('✅ Database disconnected');
    }
  } catch (error) {
    logger.error('❌ Error disconnecting from database:', error);
  }
}

// Get Prisma client instance
function getPrismaClient() {
  if (!prisma) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return prisma;
}

// Database health check
async function checkDatabaseHealth() {
  try {
    if (!prisma) {
      return { status: 'disconnected', message: 'Database not connected' };
    }

    // Simple query to test connection
    await prisma.$queryRaw`SELECT 1`;
    
    return { 
      status: 'healthy', 
      message: 'Database connection is healthy',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Database health check failed:', error);
    return { 
      status: 'unhealthy', 
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Transaction helper
async function withTransaction(callback) {
  const client = getPrismaClient();
  return await client.$transaction(callback);
}

// Soft delete helper
async function softDelete(model, id, userId = null) {
  const client = getPrismaClient();
  
  // Log the deletion
  if (userId) {
    await client.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resource: model.toUpperCase(),
        details: { id, soft: true },
      },
    });
  }

  // For now, we'll do hard delete since we don't have soft delete fields
  // In production, you might want to add isDeleted and deletedAt fields
  return await client[model].delete({
    where: { id },
  });
}

// Pagination helper
function createPaginationQuery(page = 1, limit = 10) {
  const skip = (page - 1) * limit;
  return {
    skip,
    take: limit,
  };
}

// Search helper
function createSearchQuery(searchTerm, fields) {
  if (!searchTerm) return {};

  const searchConditions = fields.map(field => ({
    [field]: {
      contains: searchTerm,
      mode: 'insensitive',
    },
  }));

  return {
    OR: searchConditions,
  };
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient,
  checkDatabaseHealth,
  withTransaction,
  softDelete,
  createPaginationQuery,
  createSearchQuery,
};
