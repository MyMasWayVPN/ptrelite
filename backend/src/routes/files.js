const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const unzipper = require('unzipper');
const tar = require('tar');
const { body, param, query, validationResult } = require('express-validator');
const { getPrismaClient } = require('../utils/database');
const { getDockerClient, ContainerManager } = require('../utils/docker');
const { verifyToken, requireContainerOwnership, auditLog } = require('../middleware/auth');
const { fileLimiter } = require('../middleware/rateLimiter');
const { asyncHandler, sendSuccessResponse, ValidationError, NotFoundError, FileSystemError } = require('../middleware/errorHandler');
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

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || '/tmp/uploads';
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024, // 100MB default
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    // Security: Block potentially dangerous files
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (dangerousExtensions.includes(fileExt)) {
      return cb(new ValidationError(`File type ${fileExt} is not allowed`), false);
    }
    
    cb(null, true);
  }
});

// Validation rules
const pathValidation = [
  param('containerId')
    .isUUID()
    .withMessage('Invalid container ID'),
  query('path')
    .optional()
    .custom((value) => {
      // Prevent path traversal
      if (value && (value.includes('..') || value.includes('~') || path.isAbsolute(value))) {
        throw new Error('Invalid path: path traversal detected');
      }
      return true;
    }),
];

const createFileValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('File name must be between 1 and 255 characters')
    .custom((value) => {
      // Prevent dangerous file names
      if (value.includes('..') || value.includes('/') || value.includes('\\')) {
        throw new Error('Invalid file name');
      }
      return true;
    }),
  body('content')
    .optional()
    .isString()
    .withMessage('Content must be a string'),
  body('isDirectory')
    .optional()
    .isBoolean()
    .withMessage('isDirectory must be a boolean'),
];

const renameValidation = [
  body('newName')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('New name must be between 1 and 255 characters')
    .custom((value) => {
      if (value.includes('..') || value.includes('/') || value.includes('\\')) {
        throw new Error('Invalid file name');
      }
      return true;
    }),
];

// Helper functions
const sanitizePath = (filePath) => {
  if (!filePath) return '/';
  
  // Remove leading slash and resolve path
  const cleanPath = path.posix.normalize(filePath.replace(/^\/+/, ''));
  
  // Prevent path traversal
  if (cleanPath.includes('..') || cleanPath.startsWith('/')) {
    throw new ValidationError('Invalid path: path traversal detected');
  }
  
  return '/' + cleanPath;
};

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
    throw new FileSystemError('Failed to execute command in container', 'exec');
  }
};

const getContainerPath = (containerId, filePath) => {
  const sanitized = sanitizePath(filePath);
  return `/app${sanitized}`;
};

// Routes

// @desc    List files and directories
// @route   GET /api/files/:containerId
// @access  Private
router.get('/:containerId', verifyToken, requireContainerOwnership, pathValidation, asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { path: filePath = '/' } = req.query;
  const prisma = getPrismaClient();

  // Get container info
  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true, status: true },
  });

  if (!container) {
    throw new NotFoundError('Container not found');
  }

  if (!container.dockerId) {
    throw new ValidationError('Container has no Docker ID');
  }

  const containerPath = getContainerPath(containerId, filePath);
  
  // List directory contents
  const command = `ls -la "${containerPath}" 2>/dev/null || echo "ERROR: Directory not found"`;
  const result = await executeInContainer(container.dockerId, command);

  if (result.output.includes('ERROR:') || result.exitCode !== 0) {
    throw new NotFoundError('Directory not found or inaccessible');
  }

  // Parse ls output
  const lines = result.output.split('\n').filter(line => line.trim());
  const files = [];

  for (const line of lines.slice(1)) { // Skip first line (total)
    const parts = line.split(/\s+/);
    if (parts.length >= 9) {
      const permissions = parts[0];
      const size = parts[4];
      const name = parts.slice(8).join(' ');

      // Skip . and .. entries
      if (name === '.' || name === '..') continue;

      const isDirectory = permissions.startsWith('d');
      const isSymlink = permissions.startsWith('l');

      files.push({
        name,
        type: isDirectory ? 'directory' : (isSymlink ? 'symlink' : 'file'),
        size: isDirectory ? null : parseInt(size) || 0,
        permissions,
        path: path.posix.join(filePath, name),
      });
    }
  }

  // Sort: directories first, then files
  files.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  sendSuccessResponse(res, {
    path: filePath,
    files,
    containerStatus: container.status,
  }, 'Directory contents retrieved successfully');
}));

// @desc    Get file content
// @route   GET /api/files/:containerId/content
// @access  Private
router.get('/:containerId/content', verifyToken, requireContainerOwnership, pathValidation, asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { path: filePath } = req.query;
  const prisma = getPrismaClient();

  if (!filePath) {
    throw new ValidationError('File path is required');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const containerPath = getContainerPath(containerId, filePath);
  
  // Check if file exists and get its info
  const statCommand = `stat -c "%s %F" "${containerPath}" 2>/dev/null || echo "ERROR"`;
  const statResult = await executeInContainer(container.dockerId, statCommand);

  if (statResult.output.includes('ERROR') || statResult.exitCode !== 0) {
    throw new NotFoundError('File not found');
  }

  const [sizeStr, fileType] = statResult.output.trim().split(' ', 2);
  const fileSize = parseInt(sizeStr);

  if (fileType.includes('directory')) {
    throw new ValidationError('Cannot read directory as file');
  }

  // Limit file size for reading (10MB)
  if (fileSize > 10 * 1024 * 1024) {
    throw new ValidationError('File too large to read (max 10MB)');
  }

  // Read file content
  const readCommand = `cat "${containerPath}"`;
  const readResult = await executeInContainer(container.dockerId, readCommand);

  if (readResult.exitCode !== 0) {
    throw new FileSystemError('Failed to read file', 'read');
  }

  sendSuccessResponse(res, {
    path: filePath,
    content: readResult.output,
    size: fileSize,
    encoding: 'utf8',
  }, 'File content retrieved successfully');
}));

// @desc    Create file or directory
// @route   POST /api/files/:containerId
// @access  Private
router.post('/:containerId', verifyToken, requireContainerOwnership, fileLimiter, createFileValidation, auditLog('FILE_CREATE', 'FILE'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { containerId } = req.params;
  const { name, content = '', isDirectory = false, path: parentPath = '/' } = req.body;
  const prisma = getPrismaClient();

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const fullPath = path.posix.join(parentPath, name);
  const containerPath = getContainerPath(containerId, fullPath);

  // Check if file/directory already exists
  const existsCommand = `test -e "${containerPath}" && echo "EXISTS" || echo "NOT_EXISTS"`;
  const existsResult = await executeInContainer(container.dockerId, existsCommand);

  if (existsResult.output.includes('EXISTS')) {
    throw new ValidationError('File or directory already exists');
  }

  let command;
  if (isDirectory) {
    command = `mkdir -p "${containerPath}"`;
  } else {
    // Create file with content
    const escapedContent = content.replace(/'/g, "'\"'\"'");
    command = `echo '${escapedContent}' > "${containerPath}"`;
  }

  const result = await executeInContainer(container.dockerId, command);

  if (result.exitCode !== 0) {
    throw new FileSystemError(`Failed to create ${isDirectory ? 'directory' : 'file'}`, 'create');
  }

  logger.audit(`${isDirectory ? 'Directory' : 'File'} created`, {
    userId: req.user.id,
    containerId,
    path: fullPath,
    isDirectory,
    ip: req.ip,
  });

  sendSuccessResponse(res, {
    name,
    path: fullPath,
    type: isDirectory ? 'directory' : 'file',
  }, `${isDirectory ? 'Directory' : 'File'} created successfully`, 201);
}));

// @desc    Update file content
// @route   PUT /api/files/:containerId/content
// @access  Private
router.put('/:containerId/content', verifyToken, requireContainerOwnership, fileLimiter, auditLog('FILE_UPDATE', 'FILE'), asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { path: filePath, content } = req.body;
  const prisma = getPrismaClient();

  if (!filePath || content === undefined) {
    throw new ValidationError('File path and content are required');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const containerPath = getContainerPath(containerId, filePath);

  // Check if file exists and is not a directory
  const statCommand = `stat -c "%F" "${containerPath}" 2>/dev/null || echo "ERROR"`;
  const statResult = await executeInContainer(container.dockerId, statCommand);

  if (statResult.output.includes('ERROR')) {
    throw new NotFoundError('File not found');
  }

  if (statResult.output.includes('directory')) {
    throw new ValidationError('Cannot write to directory');
  }

  // Write content to file
  const escapedContent = content.replace(/'/g, "'\"'\"'");
  const writeCommand = `echo '${escapedContent}' > "${containerPath}"`;
  const writeResult = await executeInContainer(container.dockerId, writeCommand);

  if (writeResult.exitCode !== 0) {
    throw new FileSystemError('Failed to write file', 'write');
  }

  logger.audit('File updated', {
    userId: req.user.id,
    containerId,
    path: filePath,
    size: content.length,
    ip: req.ip,
  });

  sendSuccessResponse(res, {
    path: filePath,
    size: content.length,
  }, 'File updated successfully');
}));

// @desc    Rename file or directory
// @route   PUT /api/files/:containerId/rename
// @access  Private
router.put('/:containerId/rename', verifyToken, requireContainerOwnership, fileLimiter, renameValidation, auditLog('FILE_RENAME', 'FILE'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { containerId } = req.params;
  const { path: filePath, newName } = req.body;
  const prisma = getPrismaClient();

  if (!filePath) {
    throw new ValidationError('File path is required');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const oldContainerPath = getContainerPath(containerId, filePath);
  const newPath = path.posix.join(path.dirname(filePath), newName);
  const newContainerPath = getContainerPath(containerId, newPath);

  // Check if source exists
  const existsCommand = `test -e "${oldContainerPath}" && echo "EXISTS" || echo "NOT_EXISTS"`;
  const existsResult = await executeInContainer(container.dockerId, existsCommand);

  if (!existsResult.output.includes('EXISTS')) {
    throw new NotFoundError('File or directory not found');
  }

  // Check if destination already exists
  const destExistsCommand = `test -e "${newContainerPath}" && echo "EXISTS" || echo "NOT_EXISTS"`;
  const destExistsResult = await executeInContainer(container.dockerId, destExistsCommand);

  if (destExistsResult.output.includes('EXISTS')) {
    throw new ValidationError('Destination already exists');
  }

  // Rename file/directory
  const renameCommand = `mv "${oldContainerPath}" "${newContainerPath}"`;
  const renameResult = await executeInContainer(container.dockerId, renameCommand);

  if (renameResult.exitCode !== 0) {
    throw new FileSystemError('Failed to rename file or directory', 'rename');
  }

  logger.audit('File renamed', {
    userId: req.user.id,
    containerId,
    oldPath: filePath,
    newPath,
    ip: req.ip,
  });

  sendSuccessResponse(res, {
    oldPath: filePath,
    newPath,
    newName,
  }, 'File renamed successfully');
}));

// @desc    Delete file or directory
// @route   DELETE /api/files/:containerId
// @access  Private
router.delete('/:containerId', verifyToken, requireContainerOwnership, fileLimiter, auditLog('FILE_DELETE', 'FILE'), asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { path: filePath, recursive = false } = req.body;
  const prisma = getPrismaClient();

  if (!filePath) {
    throw new ValidationError('File path is required');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const containerPath = getContainerPath(containerId, filePath);

  // Check if file/directory exists
  const existsCommand = `test -e "${containerPath}" && echo "EXISTS" || echo "NOT_EXISTS"`;
  const existsResult = await executeInContainer(container.dockerId, existsCommand);

  if (!existsResult.output.includes('EXISTS')) {
    throw new NotFoundError('File or directory not found');
  }

  // Delete file/directory
  let deleteCommand;
  if (recursive) {
    deleteCommand = `rm -rf "${containerPath}"`;
  } else {
    deleteCommand = `rm "${containerPath}"`;
  }

  const deleteResult = await executeInContainer(container.dockerId, deleteCommand);

  if (deleteResult.exitCode !== 0) {
    if (deleteResult.error.includes('Is a directory')) {
      throw new ValidationError('Cannot delete directory without recursive flag');
    }
    throw new FileSystemError('Failed to delete file or directory', 'delete');
  }

  logger.audit('File deleted', {
    userId: req.user.id,
    containerId,
    path: filePath,
    recursive,
    ip: req.ip,
  });

  sendSuccessResponse(res, null, 'File or directory deleted successfully');
}));

// @desc    Upload files
// @route   POST /api/files/:containerId/upload
// @access  Private
router.post('/:containerId/upload', verifyToken, requireContainerOwnership, fileLimiter, upload.array('files', 10), auditLog('FILE_UPLOAD', 'FILE'), asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { path: targetPath = '/' } = req.body;
  const files = req.files;
  const prisma = getPrismaClient();

  if (!files || files.length === 0) {
    throw new ValidationError('No files uploaded');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const uploadedFiles = [];

  try {
    for (const file of files) {
      const targetFilePath = path.posix.join(targetPath, file.originalname);
      const containerPath = getContainerPath(containerId, targetFilePath);

      // Copy file to container
      const docker = getDockerClient();
      const containerObj = docker.getContainer(container.dockerId);
      
      // Create tar stream with the file
      const tarStream = tar.create({
        cwd: path.dirname(file.path),
      }, [path.basename(file.path)]);

      await containerObj.putArchive(tarStream, {
        path: path.dirname(containerPath),
      });

      // Rename file in container to original name
      const renameCommand = `mv "${path.dirname(containerPath)}/${path.basename(file.path)}" "${containerPath}"`;
      await executeInContainer(container.dockerId, renameCommand);

      uploadedFiles.push({
        originalName: file.originalname,
        path: targetFilePath,
        size: file.size,
        mimetype: file.mimetype,
      });

      // Clean up temporary file
      await fs.unlink(file.path);
    }

    logger.audit('Files uploaded', {
      userId: req.user.id,
      containerId,
      files: uploadedFiles.map(f => ({ name: f.originalName, size: f.size })),
      targetPath,
      ip: req.ip,
    });

    sendSuccessResponse(res, {
      uploadedFiles,
      targetPath,
    }, 'Files uploaded successfully', 201);

  } catch (error) {
    // Clean up temporary files on error
    for (const file of files) {
      try {
        await fs.unlink(file.path);
      } catch (cleanupError) {
        logger.error('Failed to cleanup temporary file:', cleanupError);
      }
    }
    throw error;
  }
}));

// @desc    Download file
// @route   GET /api/files/:containerId/download
// @access  Private
router.get('/:containerId/download', verifyToken, requireContainerOwnership, pathValidation, auditLog('FILE_DOWNLOAD', 'FILE'), asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { path: filePath } = req.query;
  const prisma = getPrismaClient();

  if (!filePath) {
    throw new ValidationError('File path is required');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const containerPath = getContainerPath(containerId, filePath);

  // Check if file exists and is not a directory
  const statCommand = `stat -c "%s %F" "${containerPath}" 2>/dev/null || echo "ERROR"`;
  const statResult = await executeInContainer(container.dockerId, statCommand);

  if (statResult.output.includes('ERROR')) {
    throw new NotFoundError('File not found');
  }

  const [sizeStr, fileType] = statResult.output.trim().split(' ', 2);
  
  if (fileType.includes('directory')) {
    throw new ValidationError('Cannot download directory directly');
  }

  // Get file from container
  const docker = getDockerClient();
  const containerObj = docker.getContainer(container.dockerId);
  
  const tarStream = await containerObj.getArchive({
    path: containerPath,
  });

  const fileName = path.basename(filePath);
  
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  // Extract file from tar and pipe to response
  tarStream.pipe(unzipper.Parse())
    .on('entry', (entry) => {
      if (entry.path === fileName) {
        entry.pipe(res);
      } else {
        entry.autodrain();
      }
    })
    .on('error', (error) => {
      logger.error('Download error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Download failed' });
      }
    });

  logger.audit('File downloaded', {
    userId: req.user.id,
    containerId,
    path: filePath,
    size: parseInt(sizeStr),
    ip: req.ip,
  });
}));

// @desc    Create archive (zip/tar)
// @route   POST /api/files/:containerId/archive
// @access  Private
router.post('/:containerId/archive', verifyToken, requireContainerOwnership, fileLimiter, auditLog('FILE_ARCHIVE', 'FILE'), asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { paths, format = 'zip', archiveName } = req.body;
  const prisma = getPrismaClient();

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw new ValidationError('Paths array is required');
  }

  if (!['zip', 'tar', 'tar.gz'].includes(format)) {
    throw new ValidationError('Format must be zip, tar, or tar.gz');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const sanitizedPaths = paths.map(p => sanitizePath(p));
  const containerPaths = sanitizedPaths.map(p => getContainerPath(containerId, p));
  
  // Create archive in container
  const archiveFileName = archiveName || `archive_${Date.now()}.${format}`;
  const archivePath = `/tmp/${archiveFileName}`;

  let archiveCommand;
  if (format === 'zip') {
    archiveCommand = `cd /app && zip -r "${archivePath}" ${containerPaths.map(p => `"${p.replace('/app/', '')}"`).join(' ')}`;
  } else if (format === 'tar') {
    archiveCommand = `cd /app && tar -cf "${archivePath}" ${containerPaths.map(p => `"${p.replace('/app/', '')}"`).join(' ')}`;
  } else { // tar.gz
    archiveCommand = `cd /app && tar -czf "${archivePath}" ${containerPaths.map(p => `"${p.replace('/app/', '')}"`).join(' ')}`;
  }

  const archiveResult = await executeInContainer(container.dockerId, archiveCommand);

  if (archiveResult.exitCode !== 0) {
    throw new FileSystemError('Failed to create archive', 'archive');
  }

  logger.audit('Archive created', {
    userId: req.user.id,
    containerId,
    paths: sanitizedPaths,
    format,
    archiveName: archiveFileName,
    ip: req.ip,
  });

  sendSuccessResponse(res, {
    archiveName: archiveFileName,
    archivePath: `/tmp/${archiveFileName}`,
    format,
    paths: sanitizedPaths,
  }, 'Archive created successfully', 201);
}));

// @desc    Extract archive
// @route   POST /api/files/:containerId/extract
// @access  Private
router.post('/:containerId/extract', verifyToken, requireContainerOwnership, fileLimiter, auditLog('FILE_EXTRACT', 'FILE'), asyncHandler(async (req, res) => {
  const { containerId } = req.params;
  const { archivePath, targetPath = '/', overwrite = false } = req.body;
  const prisma = getPrismaClient();

  if (!archivePath) {
    throw new ValidationError('Archive path is required');
  }

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { dockerId: true },
  });

  if (!container || !container.dockerId) {
    throw new NotFoundError('Container not found');
  }

  const containerArchivePath = getContainerPath(containerId, archivePath);
  const containerTargetPath = getContainerPath(containerId, targetPath);

  // Check if archive exists
  const existsCommand = `test -f "${containerArchivePath}" && echo "EXISTS" || echo "NOT_EXISTS"`;
  const existsResult = await executeInContainer(container.dockerId, existsCommand);

  if (!existsResult.output.includes('EXISTS')) {
    throw new NotFoundError('Archive file not found');
  }

  // Determine archive type and extract
  const fileExt = path.extname(archivePath).toLowerCase();
  let extractCommand;

  if (fileExt === '.zip') {
    extractCommand = `cd "${containerTargetPath}" && unzip ${overwrite ? '-o' : ''} "${containerArchivePath}"`;
  } else if (fileExt === '.tar') {
    extractCommand = `cd "${containerTargetPath}" && tar -xf "${containerArchivePath}"`;
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    extractCommand = `cd "${containerTargetPath}" && tar -xzf "${containerArchivePath}"`;
  } else {
    throw new ValidationError('Unsupported archive format. Supported: .zip, .tar, .tar.gz, .tgz');
  }

  const extractResult = await executeInContainer(container.dockerId, extractCommand);

  if (extractResult.exitCode !== 0) {
    throw new FileSystemError('Failed to extract archive', 'extract');
  }

  logger.audit('Archive extracted', {
    userId: req.user.id,
    containerId,
    archivePath,
    targetPath,
    overwrite,
    ip: req.ip,
  });

  sendSuccessResponse(res, {
    archivePath,
    targetPath,
    overwrite,
  }, 'Archive extracted successfully');
}));

module.exports = router;
