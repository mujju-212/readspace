# Production Multi-Stage Dockerfile for ReadSpace Web App
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci

# Copy source code and build Vite static bundle
COPY . .
RUN npm run build

# Runner stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5173

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled assets and server code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/api ./api
COPY --from=builder /app/public ./public

# Default data directory for local JSON storage fallback
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node
EXPOSE 5173

CMD ["node", "server/index.mjs"]
