# Dockerfile for agentvault server
# Multi-stage build for smaller production image

# Stage 1: Build
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/cli/package.json ./packages/cli/
COPY packages/core/package.json ./packages/core/
COPY packages/governance/package.json ./packages/governance/
COPY packages/importer/package.json ./packages/importer/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/vault/package.json ./packages/vault/
COPY examples/slack-webhook/package.json ./examples/slack-webhook/
COPY tsconfig.base.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prefer-offline

# Copy source code
COPY packages/ ./packages/

# Build all packages
RUN pnpm build

# Stage 2: Production
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

# Create non-root user
RUN addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/cli/package.json ./packages/cli/
COPY packages/core/package.json ./packages/core/
COPY packages/governance/package.json ./packages/governance/
COPY packages/importer/package.json ./packages/importer/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/vault/package.json ./packages/vault/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --prefer-offline

# Copy built artifacts from builder
COPY --from=builder /app/packages ./packages

# Change ownership to non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start server
CMD ["node", "packages/server/dist/index.js"]
