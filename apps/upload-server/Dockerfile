FROM oven/bun:1.4.2-slim AS base
WORKDIR /app

FROM base AS pruner
RUN bun add --global turbo@2.10.12
COPY package.json bun.lock turbo.json ./
COPY apps/upload-server/ ./apps/upload-server/
COPY packages/ ./packages/
RUN turbo prune upload-server --docker

FROM base AS dependencies
COPY --from=pruner /app/out/json/ ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=pruner /app/out/full/ ./
COPY tsconfig.base.json ./

FROM base AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tar gzip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/ ./
WORKDIR /app/apps/upload-server
RUN mkdir -p output/upload && chown -R bun:bun output
USER bun
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun -e 'const response = await fetch(`http://127.0.0.1:${process.env.PORT}/`); process.exit(response.ok ? 0 : 1);'
CMD ["bun", "src/upload-server.ts"]
