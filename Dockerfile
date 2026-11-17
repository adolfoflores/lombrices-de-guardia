FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Vite is required during the build, even if the platform sets NODE_ENV=production.
RUN npm ci --include=dev --no-audit --no-fund
COPY index.html ./
COPY client ./client
COPY shared ./shared
COPY public ./public
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY scripts/build.js ./scripts/build.js
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/shared ./shared
COPY --chown=node:node server ./server
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
USER node
# HTTP and the /socket WebSocket share this internal port.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health', { signal: AbortSignal.timeout(3000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/index.js"]
