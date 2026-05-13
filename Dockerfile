# Multi-stage build for Spotify MCP Server
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (package-lock.json not in repo)
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build && \
    chmod +x build/index.js

# Runtime stage
FROM node:22-alpine

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Install Express for HTTP wrapper
RUN npm install --omit=dev express

# Copy HTTP wrapper
COPY docker/http-wrapper.cjs ./http-wrapper.cjs

# Create non-root user
RUN addgroup -g 1001 mcp && \
    adduser -D -u 1001 -G mcp mcp && \
    chown -R mcp:mcp /app

USER mcp

# Expose port for HTTP wrapper
EXPOSE 8080

# Set environment variables
ENV PORT=8080 \
    NODE_ENV=production

# Default command runs the HTTP wrapper
CMD ["node", "/app/http-wrapper.cjs"]
