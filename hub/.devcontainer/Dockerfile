FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssl \
    && rm -rf /var/lib/apt/lists/*

USER node
