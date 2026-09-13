# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS pruner
COPY --from=oven/bun:1.4.2-slim /usr/local/bin/bun /usr/local/bin/bun
RUN bun install --global turbo@2.10.12
ENV PATH="/root/.bun/bin:${PATH}"
COPY . .
RUN turbo prune web-client --docker

FROM base AS builder
COPY --from=pruner /usr/local/bin/bun /usr/local/bin/bun
COPY --from=pruner /app/out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts
COPY --from=pruner /app/out/full/ ./
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

ARG NEXT_PUBLIC_UPLOAD_SERVER_URL
ARG NEXT_PUBLIC_PREVIEW_BASE_URL
# Route collection imports auth/database modules but needs no live credentials.
RUN --mount=type=cache,target=/app/apps/web-client/.next/cache \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    GITHUB_CLIENT_ID=docker-build \
    GITHUB_CLIENT_SECRET=docker-build \
    BETTER_AUTH_SECRET=docker-build-placeholder-not-for-runtime-0000 \
    BETTER_AUTH_URL=http://localhost:3002 \
    bun run build --filter=web-client

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3002 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap ca-certificates zip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app/apps/web-client/.next/standalone/ ./
COPY --from=builder --chown=node:node /app/apps/web-client/.next/static/ ./apps/web-client/.next/static/
COPY --from=builder --chown=node:node /app/apps/web-client/public/ ./apps/web-client/public/
COPY --from=builder --chown=node:node /app/apps/web-client/templates/ ./apps/web-client/templates/
COPY --from=builder --chown=node:node /app/apps/web-client/src/mastra/skills/ ./apps/web-client/src/mastra/skills/
WORKDIR /app/apps/web-client
RUN mkdir -p .sandbox .sandbox-profiles /home/node/.npm \
    && chown -R node:node .sandbox .sandbox-profiles /home/node/.npm
USER node
EXPOSE 3002
CMD ["node", "server.js"]
