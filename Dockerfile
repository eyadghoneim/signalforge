# SignalForge — Multi-stage production build (Render / Railway / Fly.io / VPS)
# Stage 1: Build client assets and bundle the server
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Stage 2: Minimal runtime image without devDependencies or build toolchains
FROM node:20-alpine AS runner

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy built frontend assets and bundled backend from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Prepare persistent data directory with non-root ownership
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
