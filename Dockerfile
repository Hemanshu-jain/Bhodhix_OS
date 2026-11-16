FROM node:22-bookworm-slim AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    BIND_HOST=0.0.0.0 \
    AUTH_STORE_FILE=/data/auth/team.json \
    BHODIX_PIN_FILE=/data/auth/.pin \
    TENANT_DATA_DIR=/data/tenants \
    MCP_OAUTH_STORE_FILE=/data/auth/mcp-oauth.json \
    LEGACY_VAULT_DIR=/data/vault

WORKDIR /app
COPY server/package*.json ./server/
RUN npm ci --omit=dev --prefix server
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/scripts ./server/scripts
COPY --from=client-build /build/client/dist ./client/dist
RUN mkdir -p /data/auth /data/tenants /data/vault && chown -R node:node /app /data

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/setup/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/src/server.js"]
