FROM oven/bun:1.4.2 AS pruner
WORKDIR /app
RUN bun add --global turbo@2.10.12
COPY . .
RUN turbo prune request-handler-server --docker

FROM oven/bun:1.4.2 AS dependencies
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json .

FROM oven/bun:1.4.2-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=dependencies /app/ .
USER bun
WORKDIR /app/apps/request-handler-server
EXPOSE 3001
CMD ["bun", "src/request-handler-server.ts"]
