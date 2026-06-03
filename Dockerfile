FROM oven/bun:1-slim AS base
WORKDIR /app

FROM base AS deps
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=bun.lock,target=bun.lock \
    --mount=type=bind,source=bunfig.toml,target=bunfig.toml \
    --mount=type=bind,source=server/package.json,target=server/package.json \
    --mount=type=bind,source=client/package.json,target=client/package.json \
    --mount=type=bind,source=shared/package.json,target=shared/package.json \
    --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

FROM deps AS builder
ENV NODE_ENV=production
COPY . .
RUN bun run --cwd client build && \
    bun run --cwd server build

FROM base AS prod-deps
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=bun.lock,target=bun.lock \
    --mount=type=bind,source=bunfig.toml,target=bunfig.toml \
    --mount=type=bind,source=server/package.json,target=server/package.json \
    --mount=type=bind,source=client/package.json,target=client/package.json \
    --mount=type=bind,source=shared/package.json,target=shared/package.json \
    --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

FROM base AS migrator
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun add --ignore-scripts drizzle-kit drizzle-orm postgres
COPY server/drizzle.migrate.config.ts ./drizzle.config.ts
COPY server/src/db/migrations ./migrations
CMD ["bunx", "drizzle-kit", "migrate", "--config=drizzle.config.ts"]

FROM base AS runtime

ARG DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    curl ca-certificates git ripgrep bubblewrap socat dumb-init wget zip jq less openssh-client procps findutils openssl sed gawk tzdata

RUN mkdir -p /data/workspace /data/agent-state && chown -R bun:bun /data

COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=prod-deps --chown=bun:bun /app/server/node_modules ./server/node_modules
COPY --from=builder --chown=bun:bun /app/server/dist ./server/dist
COPY --from=builder --chown=bun:bun /app/client/dist ./client/dist
COPY --chown=bun:bun package.json ./package.json
COPY --chown=bun:bun server/package.json ./server/package.json

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

USER bun
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--", "bun", "run", "server/dist/index.js"]
