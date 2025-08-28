const { spawn } = require('child_process');
const Docker = require('dockerode');

class WindowsConsoleHandler {
  constructor(io) {
    this.io = io;
    this.docker = new Docker();
    this.activeSessions = new Map();
  }

  initialize() {
    this.io.on('connection', (socket) => {
      console.log('Console client connected:', socket.id);

      socket.on('join-console', async (data) => {
        try {
          const { containerId, token } = data;
          
          // Verify user has access to container
          // TODO: Add proper authentication check
          
          const container = this.docker.getContainer(containerId);
          const containerInfo = await container.inspect();
          
          if (!containerInfo.State.Running) {
            socket.emit('console-error', { message: 'Container is not running' });
            return;
          }

          // Join room for this container
          socket.join(`console-${containerId}`);
          
          // Send initial connection message
          socket.emit('console-output', { 
            data: `Connected to container: ${containerInfo.Name}\r\n`,
            type: 'info'
          });

          console.log(`Client ${socket.id} joined console for container ${containerId}`);
          
        } catch (error) {
          console.error('Error joining console:', error);
          socket.emit('console-error', { message: 'Failed to connect to container' });
        }
      });

      socket.on('console-input', async (data) => {
        try {
          const { containerId, input } = data;
          
          // Execute command in container using docker exec
          const container = this.docker.getContainer(containerId);
          
          // Create exec instance
          const exec = await container.exec({
            Cmd: ['sh', '-c', input.trim()],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false
          });

          // Start exec and get stream
          const stream = await exec.start({ Tty: false });
          
          let output = '';
          
          stream.on('data', (chunk) => {
            // Docker multiplexes stdout/stderr, need to handle this
            const data = chunk.toString();
            output += data;
            
            // Send output to client
            socket.emit('console-output', { 
              data: data,
              type: 'output'
            });
          });

          stream.on('end', () => {
            socket.emit('console-output', { 
              data: '\r\n',
              type: 'output'
            });
          });

          stream.on('error', (error) => {
            socket.emit('console-error', { 
              message: `Command error: ${error.message}` 
            });
          });

        } catch (error) {
          console.error('Error executing command:', error);
          socket.emit('console-error', { 
            message: `Failed to execute command: ${error.message}` 
          });
        }
      });

      socket.on('container-action', async (data) => {
        try {
          const { containerId, action } = data;
          const container = this.docker.getContainer(containerId);

          switch (action) {
            case 'start':
              await container.start();
              socket.emit('console-output', { 
                data: 'Container started\r\n',
                type: 'info'
              });
              break;
              
            case 'stop':
              await container.stop();
              socket.emit('console-output', { 
                data: 'Container stopped\r\n',
                type: 'info'
              });
              break;
              
            case 'restart':
              await container.restart();
              socket.emit('console-output', { 
                data: 'Container restarted\r\n',
                type: 'info'
              });
              break;
              
            default:
              socket.emit('console-error', { 
                message: `Unknown action: ${action}` 
              });
          }
        } catch (error) {
          console.error('Error performing container action:', error);
          socket.emit('console-error', { 
            message: `Failed to ${data.action} container: ${error.message}` 
          });
        }
      });

      socket.on('get-container-stats', async (data) => {
        try {
          const { containerId } = data;
          const container = this.docker.getContainer(containerId);
          
          const stats = await container.stats({ stream: false });
          
          // Calculate CPU percentage
          const cpuPercent = this.calculateCPUPercent(stats);
          
          // Calculate memory usage
          const memoryUsage = stats.memory_stats.usage || 0;
          const memoryLimit = stats.memory_stats.limit || 0;
          const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

          socket.emit('container-stats', {
            cpu: cpuPercent.toFixed(2),
            memory: {
              usage: this.formatBytes(memoryUsage),
              limit: this.formatBytes(memoryLimit),
              percent: memoryPercent.toFixed(2)
            },
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          console.error('Error getting container stats:', error);
          socket.emit('console-error', { 
            message: `Failed to get container stats: ${error.message}` 
          });
        }
      });

      socket.on('disconnect', () => {
        console.log('Console client disconnected:', socket.id);
        
        // Clean up any active sessions for this socket
        for (const [sessionId, session] of this.activeSessions.entries()) {
          if (session.socketId === socket.id) {
            this.activeSessions.delete(sessionId);
          }
        }
      });
    });
  }

  calculateCPUPercent(stats) {
    // Calculate CPU percentage from Docker stats
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                     (stats.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - 
                        (stats.precpu_stats.system_cpu_usage || 0);
    
    if (systemDelta > 0 && cpuDelta > 0) {
      const cpuCount = stats.cpu_stats.online_cpus || 1;
      return (cpuDelta / systemDelta) * cpuCount * 100;
    }
    return 0;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = WindowsConsoleHandler;
