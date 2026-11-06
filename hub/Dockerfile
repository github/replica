# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY schema ./schema
COPY prisma7.config.ts ./
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then \
      node -e 'const fs=require("node:fs"); const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8")); for(const entry of Object.values(lock.packages)){delete entry.resolved} fs.writeFileSync("package-lock.json",JSON.stringify(lock))'; \
      export npm_config_registry="$NPM_REGISTRY"; \
    fi; \
    npm ci --engine-strict --no-audit --no-fund
COPY . .
RUN npm run build:runtime

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 RUNTIME_MODE=combined \
    CLIENT_DIRECTORY=/app/dist/client SHUTDOWN_TIMEOUT_MS=30000
COPY --from=build /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=build /app/schema ./schema
COPY --from=build /app/prisma7.config.ts ./
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev --ignore-scripts --offline && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
