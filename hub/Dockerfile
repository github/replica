# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY hub/package.json hub/package-lock.json hub/.npmrc ./
COPY hub/schema ./schema
COPY hub/prisma7.config.ts ./
ARG NPM_REGISTRY
RUN --mount=type=cache,id=replica-hub-npm,target=/root/.npm \
    if [ -n "$NPM_REGISTRY" ]; then \
      node -e 'const fs=require("node:fs"); const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8")); for(const entry of Object.values(lock.packages)){delete entry.resolved} fs.writeFileSync("package-lock.json",JSON.stringify(lock))'; \
      export npm_config_registry="$NPM_REGISTRY"; \
    fi; \
    npm ci --engine-strict --no-audit --no-fund
COPY hub/ .
RUN npm run build:runtime

FROM node:24-bookworm-slim AS learning
WORKDIR /opt/replica/learning
COPY packages/learning/package.json packages/learning/package-lock.json ./
COPY hub/.npmrc ./
ARG NPM_REGISTRY
RUN --mount=type=cache,id=replica-learning-npm,target=/root/.npm \
    if [ -n "$NPM_REGISTRY" ]; then \
      node -e 'const fs=require("node:fs"); const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8")); for(const entry of Object.values(lock.packages)){delete entry.resolved} fs.writeFileSync("package-lock.json",JSON.stringify(lock))'; \
      export npm_config_registry="$NPM_REGISTRY"; \
    fi; \
    npm ci --omit=dev --engine-strict --no-audit --no-fund \
    && if [ ! -f node_modules/@github/copilot-sdk/package.json ]; then \
      echo "Copilot SDK was not installed" >&2; exit 1; \
    fi \
    && test -f node_modules/@github/copilot-sdk/package.json
COPY packages/learning/ .

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 RUNTIME_MODE=combined \
    CLIENT_DIRECTORY=/app/dist/client SHUTDOWN_TIMEOUT_MS=30000 \
    REPLICA_LEARNING_CLI=/opt/replica/learning/bin/replica-learning.mjs
COPY --from=build /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=build /app/schema ./schema
COPY --from=build /app/prisma7.config.ts ./
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev --ignore-scripts --offline && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=learning /opt/replica/learning /opt/replica/learning
USER node
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
