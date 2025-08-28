const Docker = require('dockerode');
const logger = require('./logger');

let docker;

// Initialize Docker client
async function initializeDocker() {
  try {
    // Docker configuration
    const dockerConfig = {
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    };

    // For Windows, use named pipe
    if (process.platform === 'win32') {
      dockerConfig.socketPath = '\\\\.\\pipe\\docker_engine';
    }

    docker = new Docker(dockerConfig);

    // Test Docker connection
    const info = await docker.info();
    logger.info('✅ Docker connected successfully', {
      version: info.ServerVersion,
      containers: info.Containers,
      images: info.Images,
    });

    return docker;
  } catch (error) {
    logger.error('❌ Failed to connect to Docker:', error);
    throw error;
  }
}

// Get Docker client instance
function getDockerClient() {
  if (!docker) {
    throw new Error('Docker not initialized. Call initializeDocker() first.');
  }
  return docker;
}

// Docker health check
async function checkDockerHealth() {
  try {
    if (!docker) {
      return { status: 'disconnected', message: 'Docker not connected' };
    }

    const info = await docker.info();
    return { 
      status: 'healthy', 
      message: 'Docker connection is healthy',
      info: {
        version: info.ServerVersion,
        containers: info.Containers,
        containersRunning: info.ContainersRunning,
        containersPaused: info.ContainersPaused,
        containersStopped: info.ContainersStopped,
        images: info.Images,
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Docker health check failed:', error);
    return { 
      status: 'unhealthy', 
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Container management helpers
class ContainerManager {
  constructor(dockerClient) {
    this.docker = dockerClient;
  }

  // Create container
  async createContainer(config) {
    try {
      const {
        name,
        image,
        cmd = [],
        env = [],
        ports = {},
        volumes = [],
        workingDir = '/app',
        memory = '512m',
        cpus = '0.5',
        networkMode = 'bridge',
        restartPolicy = { Name: 'unless-stopped' },
        labels = {},
      } = config;

      // Ensure image exists
      await this.pullImage(image);

      const containerConfig = {
        Image: image,
        name,
        Cmd: cmd.length > 0 ? cmd : undefined,
        Env: env,
        ExposedPorts: ports,
        WorkingDir: workingDir,
        Labels: {
          'panel.managed': 'true',
          'panel.created': new Date().toISOString(),
          ...labels,
        },
        HostConfig: {
          Memory: this.parseMemory(memory),
          CpuQuota: Math.floor(parseFloat(cpus) * 100000),
          CpuPeriod: 100000,
          RestartPolicy: restartPolicy,
          NetworkMode: networkMode,
          Binds: volumes,
          PortBindings: this.formatPortBindings(ports),
          AutoRemove: false,
        },
        NetworkingConfig: {
          EndpointsConfig: {},
        },
      };

      const container = await this.docker.createContainer(containerConfig);
      logger.info('✅ Container created successfully', { 
        id: container.id, 
        name,
        image 
      });

      return container;
    } catch (error) {
      logger.error('❌ Failed to create container:', error);
      throw error;
    }
  }

  // Start container
  async startContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();
      logger.info('✅ Container started', { id: containerId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to start container:', error);
      throw error;
    }
  }

  // Stop container
  async stopContainer(containerId, timeout = 10) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: timeout });
      logger.info('✅ Container stopped', { id: containerId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to stop container:', error);
      throw error;
    }
  }

  // Restart container
  async restartContainer(containerId, timeout = 10) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.restart({ t: timeout });
      logger.info('✅ Container restarted', { id: containerId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to restart container:', error);
      throw error;
    }
  }

  // Remove container
  async removeContainer(containerId, force = false) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });
      logger.info('✅ Container removed', { id: containerId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to remove container:', error);
      throw error;
    }
  }

  // Get container info
  async getContainerInfo(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info;
    } catch (error) {
      logger.error('❌ Failed to get container info:', error);
      throw error;
    }
  }

  // Get container stats
  async getContainerStats(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      // Calculate CPU percentage
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                      (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta = stats.cpu_stats.system_cpu_usage - 
                         (stats.precpu_stats.system_cpu_usage || 0);
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

      // Calculate memory usage
      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

      return {
        cpu: {
          usage: cpuPercent.toFixed(2),
          limit: '100%',
        },
        memory: {
          usage: this.formatBytes(memoryUsage),
          limit: this.formatBytes(memoryLimit),
          percent: memoryPercent.toFixed(2),
        },
        network: stats.networks || {},
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('❌ Failed to get container stats:', error);
      throw error;
    }
  }

  // List containers
  async listContainers(all = false, filters = {}) {
    try {
      const containers = await this.docker.listContainers({ 
        all,
        filters: JSON.stringify(filters)
      });
      return containers;
    } catch (error) {
      logger.error('❌ Failed to list containers:', error);
      throw error;
    }
  }

  // Execute command in container
  async execCommand(containerId, cmd, options = {}) {
    try {
      const container = this.docker.getContainer(containerId);
      
      const execOptions = {
        Cmd: Array.isArray(cmd) ? cmd : ['/bin/sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
        Tty: options.tty || false,
        ...options,
      };

      const exec = await container.exec(execOptions);
      const stream = await exec.start({ hijack: true, stdin: true });

      return { exec, stream };
    } catch (error) {
      logger.error('❌ Failed to execute command:', error);
      throw error;
    }
  }

  // Pull image
  async pullImage(imageName) {
    try {
      logger.info('📥 Pulling image:', imageName);
      
      const stream = await this.docker.pull(imageName);
      
      return new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, res) => {
          if (err) {
            logger.error('❌ Failed to pull image:', err);
            reject(err);
          } else {
            logger.info('✅ Image pulled successfully:', imageName);
            resolve(res);
          }
        });
      });
    } catch (error) {
      logger.error('❌ Failed to pull image:', error);
      throw error;
    }
  }

  // List images
  async listImages() {
    try {
      const images = await this.docker.listImages();
      return images;
    } catch (error) {
      logger.error('❌ Failed to list images:', error);
      throw error;
    }
  }

  // Helper methods
  parseMemory(memory) {
    if (typeof memory === 'number') return memory;
    
    const units = {
      'b': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024,
    };
    
    const match = memory.toLowerCase().match(/^(\d+)([bkmg]?)$/);
    if (!match) return 512 * 1024 * 1024; // Default 512MB
    
    const value = parseInt(match[1]);
    const unit = match[2] || 'b';
    
    return value * units[unit];
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatPortBindings(exposedPorts) {
    const portBindings = {};
    
    for (const port in exposedPorts) {
      portBindings[port] = [{ HostPort: '' }]; // Let Docker assign random port
    }
    
    return portBindings;
  }
}

module.exports = {
  initializeDocker,
  getDockerClient,
  checkDockerHealth,
  ContainerManager,
};
