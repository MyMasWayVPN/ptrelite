FROM node:18-alpine

# Install dependencies untuk Docker dan system utilities
RUN apk add --no-cache \
    docker-cli \
    python3 \
    make \
    g++ \
    git \
    curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src/

# Create non-root user untuk security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Create directories dengan proper permissions
RUN mkdir -p /app/logs /app/uploads /app/data
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Start application
CMD ["npm", "start"]
