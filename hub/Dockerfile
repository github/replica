# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY hub/package.json ./hub/
COPY infrastructure/package.json ./infrastructure/
COPY packages/learning/package.json ./packages/learning/
COPY scripts/package.json ./scripts/
COPY hub/schema ./hub/schema
COPY hub/prisma7.config.ts ./hub/
ARG NPM_REGISTRY
RUN --mount=type=cache,id=replica-hub-npm,target=/root/.npm \
    if [ -n "$NPM_REGISTRY" ]; then \
      node -e 'const fs=require("node:fs"); const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8")); const workspaces=new Set(lock.packages[""].workspaces); for(const [path,entry] of Object.entries(lock.packages)){if(!path||workspaces.has(path)||entry.link){continue} if(!entry.integrity){throw new Error(`Missing package integrity for ${path}`)} delete entry.resolved} fs.writeFileSync("package-lock.json",JSON.stringify(lock))'; \
      export npm_config_registry="$NPM_REGISTRY"; \
    fi; \
    npm ci --workspace replica-hub --include=optional --engine-strict --fetch-retries=5 --prefer-offline --no-audit --no-fund
COPY hub/ ./hub/
RUN npm run build:runtime --workspace replica-hub \
    && npm prune --workspace replica-hub --omit=dev --ignore-scripts --offline

FROM node:24-bookworm-slim AS learning
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY hub/package.json ./hub/
COPY infrastructure/package.json ./infrastructure/
COPY packages/learning/package.json ./packages/learning/
COPY scripts/package.json ./scripts/
ARG NPM_REGISTRY
RUN --mount=type=cache,id=replica-learning-npm,target=/root/.npm \
    if [ -n "$NPM_REGISTRY" ]; then \
      node -e 'const fs=require("node:fs"); const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8")); const workspaces=new Set(lock.packages[""].workspaces); for(const [path,entry] of Object.entries(lock.packages)){if(!path||workspaces.has(path)||entry.link){continue} if(!entry.integrity){throw new Error(`Missing package integrity for ${path}`)} delete entry.resolved} fs.writeFileSync("package-lock.json",JSON.stringify(lock))'; \
      export npm_config_registry="$NPM_REGISTRY"; \
    fi; \
    npm ci --workspace @github/replica-learning --omit=dev --include=optional --engine-strict --fetch-retries=5 --prefer-offline --no-audit --no-fund \
    && if [ ! -f packages/learning/node_modules/@github/copilot-sdk/package.json ]; then \
      echo "Copilot SDK was not installed" >&2; exit 1; \
    fi
COPY packages/learning/ ./packages/learning/

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 RUNTIME_MODE=combined \
    CLIENT_DIRECTORY=/app/dist/client SHUTDOWN_TIMEOUT_MS=30000 \
    REPLICA_LEARNING_CLI=/opt/replica/learning/bin/replica-learning.mjs
COPY --from=build /repo/hub/package.json ./
COPY --from=build /repo/hub/schema ./schema
COPY --from=build /repo/hub/prisma7.config.ts ./
COPY --from=build /repo/hub/node_modules ./node_modules
COPY --from=build /repo/hub/dist ./dist
COPY --from=learning /repo/packages/learning /opt/replica/learning
RUN mkdir -p /app/storage/learning && chown -R node:node /app/storage
USER node
EXPOSE 3001
CMD ["node", "dist/server/index.js"]