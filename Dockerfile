# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for Puppeteer + pnpm
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    su-exec && \
    npm install -g pnpm@10.30.3

# Set Puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files and lockfile
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDeps needed for build)
RUN pnpm install --frozen-lockfile

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build TypeScript
RUN pnpm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S chatbot -u 1001 && \
    chown -R chatbot:nodejs /app

# Entrypoint fixes volume ownership at runtime then drops to chatbot user
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["/entrypoint.sh"]
