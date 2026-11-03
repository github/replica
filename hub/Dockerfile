# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY schema ./schema
COPY prisma7.config.ts ./
RUN npm ci --engine-strict
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
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
