FROM oven/bun:1.4.2-slim AS base
WORKDIR /app

FROM base AS pruner
RUN bun add --global turbo@2.10.12
COPY package.json bun.lock turbo.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
RUN turbo prune deploy-worker --docker

FROM base AS dependencies
COPY --from=pruner /app/out/json/ ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=pruner /app/out/full/ ./
COPY tsconfig.base.json ./

FROM base AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker:28.5.1-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dependencies /app/ ./
WORKDIR /app/apps/deploy-worker
RUN mkdir -p output/deploy && chown -R bun:bun output
USER bun
ENV NODE_ENV=production
# Absolute entrypoint lets the working directory match a host-mounted scratch path.
CMD ["bun", "/app/apps/deploy-worker/src/deploy-worker.ts"]
