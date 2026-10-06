# SignalForge — صورة إنتاجية جاهزة لأي سيرفر (Render / Railway / Fly.io / VPS)
# خطوتين: 1) npm install + build  2) node dist/server.cjs
FROM node:20-alpine

WORKDIR /app

# المكتبات أولاً عشان الكاش يشتغل
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# الكود
COPY . .

# بناء الواجهة (Vite) + حزم السيرفر (esbuild)
RUN npm run build

# Run the application as the pre-created non-root Node user. The data directory
# is created lazily by the JSON fallback and must remain writable in that mode.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
