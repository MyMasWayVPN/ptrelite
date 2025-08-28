const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { getPrismaClient } = require('../utils/database');
const { loginLimiter } = require('../middleware/rateLimiter');
const { verifyToken, extractToken } = require('../middleware/auth');
const { asyncHandler, sendSuccessResponse, sendErrorResponse, ValidationError, AuthenticationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Validation rules
const loginValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
];

const registerValidation = [
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

// Helper functions
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

const setTokenCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const clearTokenCookies = (res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
};

// Routes

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', loginLimiter, loginValidation, asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { username, password } = req.body;
  const prisma = getPrismaClient();

  // Find user
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      email: true,
      password: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    logger.security('Login attempt with invalid username', {
      username,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    throw new AuthenticationError('Invalid credentials');
  }

  if (!user.isActive) {
    logger.security('Login attempt with deactivated account', {
      userId: user.id,
      username,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    throw new AuthenticationError('Account is deactivated');
  }

  // Check password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    logger.security('Login attempt with invalid password', {
      userId: user.id,
      username,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    throw new AuthenticationError('Invalid credentials');
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user.id);

  // Save refresh token to database
  await prisma.userSession.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // Set cookies
  setTokenCookies(res, accessToken, refreshToken);

  // Log successful login
  logger.audit('User logged in', {
    userId: user.id,
    username: user.username,
    role: user.role,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Return user data (without password)
  const { password: _, ...userData } = user;
  
  sendSuccessResponse(res, {
    user: userData,
    accessToken,
  }, 'Login successful');
}));

// @desc    Register user (Admin only)
// @route   POST /api/auth/register
// @access  Private/Admin
router.post('/register', verifyToken, registerValidation, asyncHandler(async (req, res) => {
  // Only admin can register new users
  if (req.user.role !== 'ADMIN') {
    throw new AuthenticationError('Only administrators can register new users');
  }

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
    throw new ValidationError('User with this username or email already exists');
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

  // Log user creation
  logger.audit('User registered', {
    adminId: req.user.id,
    newUserId: user.id,
    username: user.username,
    role: user.role,
    ip: req.ip,
  });

  sendSuccessResponse(res, { user }, 'User registered successfully', 201);
}));

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
router.post('/refresh', asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    throw new AuthenticationError('Refresh token required');
  }

  const prisma = getPrismaClient();

  // Verify refresh token
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    throw new AuthenticationError('Invalid refresh token');
  }

  // Check if refresh token exists in database
  const session = await prisma.userSession.findUnique({
    where: { refreshToken },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    // Clean up expired session
    if (session) {
      await prisma.userSession.delete({
        where: { id: session.id },
      });
    }
    throw new AuthenticationError('Refresh token expired or invalid');
  }

  if (!session.user.isActive) {
    throw new AuthenticationError('Account is deactivated');
  }

  // Generate new tokens
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(session.userId);

  // Update refresh token in database
  await prisma.userSession.update({
    where: { id: session.id },
    data: {
      refreshToken: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // Set new cookies
  setTokenCookies(res, accessToken, newRefreshToken);

  logger.audit('Token refreshed', {
    userId: session.userId,
    ip: req.ip,
  });

  sendSuccessResponse(res, {
    user: session.user,
    accessToken,
  }, 'Token refreshed successfully');
}));

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', verifyToken, asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  const prisma = getPrismaClient();

  // Remove refresh token from database
  if (refreshToken) {
    await prisma.userSession.deleteMany({
      where: {
        refreshToken,
        userId: req.user.id,
      },
    });
  }

  // Clear cookies
  clearTokenCookies(res);

  logger.audit('User logged out', {
    userId: req.user.id,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Logout successful');
}));

// @desc    Logout from all devices
// @route   POST /api/auth/logout-all
// @access  Private
router.post('/logout-all', verifyToken, asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();

  // Remove all refresh tokens for user
  await prisma.userSession.deleteMany({
    where: { userId: req.user.id },
  });

  // Clear cookies
  clearTokenCookies(res);

  logger.audit('User logged out from all devices', {
    userId: req.user.id,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Logged out from all devices');
}));

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
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
    },
  });

  if (!user) {
    throw new AuthenticationError('User not found');
  }

  sendSuccessResponse(res, { user }, 'User data retrieved');
}));

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
router.put('/change-password', verifyToken, changePasswordValidation, asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { currentPassword, newPassword } = req.body;
  const prisma = getPrismaClient();

  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      password: true,
    },
  });

  if (!user) {
    throw new AuthenticationError('User not found');
  }

  // Verify current password
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    throw new AuthenticationError('Current password is incorrect');
  }

  // Hash new password
  const hashedNewPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

  // Update password
  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedNewPassword },
  });

  // Invalidate all sessions except current one
  const currentRefreshToken = req.cookies.refreshToken;
  await prisma.userSession.deleteMany({
    where: {
      userId: req.user.id,
      refreshToken: {
        not: currentRefreshToken,
      },
    },
  });

  logger.audit('Password changed', {
    userId: req.user.id,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Password changed successfully');
}));

// @desc    Get user sessions
// @route   GET /api/auth/sessions
// @access  Private
router.get('/sessions', verifyToken, asyncHandler(async (req, res) => {
  const prisma = getPrismaClient();

  const sessions = await prisma.userSession.findMany({
    where: { userId: req.user.id },
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
  }));

  sendSuccessResponse(res, { sessions: sessionsWithCurrent }, 'Sessions retrieved');
}));

// @desc    Revoke session
// @route   DELETE /api/auth/sessions/:sessionId
// @access  Private
router.delete('/sessions/:sessionId', verifyToken, asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const prisma = getPrismaClient();

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.userId !== req.user.id) {
    throw new AuthenticationError('Session not found');
  }

  await prisma.userSession.delete({
    where: { id: sessionId },
  });

  logger.audit('Session revoked', {
    userId: req.user.id,
    sessionId,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'Session revoked');
}));

module.exports = router;
