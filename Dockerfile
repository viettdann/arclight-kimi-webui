# base
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

COPY . .

RUN bun run --cwd client build

ARG TARGETARCH
ENV NODE_ENV=production
RUN BUN_TARGET=$([ "$TARGETARCH" = "arm64" ] && echo "bun-linux-arm64" || echo "bun-linux-x64") && \
    bun build --compile --target="${BUN_TARGET}" --external cpu-features \
    server/src/index.ts --outfile kimi-webui

FROM base AS migrator

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun add --ignore-scripts drizzle-kit drizzle-orm postgres

COPY server/drizzle.migrate.config.ts ./drizzle.config.ts
COPY server/src/db/migrations ./migrations

CMD ["bunx", "drizzle-kit", "migrate", "--config=drizzle.config.ts"]

FROM astral/uv:python3.14-trixie-slim AS runner

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache && \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl git ripgrep dumb-init

RUN useradd --create-home --uid 1000 kimi && \
    mkdir -p /kimi /data/.kimi /data/workspace && \
    chown -R kimi:kimi /kimi /data

WORKDIR /kimi
USER kimi

ENV PATH=/home/kimi/.local/bin:/usr/local/bin:/usr/bin:/bin \
    UV_TOOL_BIN_DIR=/home/kimi/.local/bin \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_PROGRESS=1

RUN --mount=type=cache,target=/home/kimi/.cache/uv,uid=1000,gid=1000 \
    mkdir -p /home/kimi/.local/bin && \
    curl -fsSL code.kimi.com/install.sh | bash

COPY --from=builder --chown=kimi:kimi /app/kimi-webui ./kimi-webui
COPY --from=builder --chown=kimi:kimi /app/client/dist ./client/dist

ARG KIMI_SHARE_DIR
ARG WORKSPACE_ROOT
ARG PORT
ENV NODE_ENV=production \
    PORT=${PORT:-3000} \
    KIMI_SHARE_DIR=${KIMI_SHARE_DIR:-/data/.kimi} \
    WORKSPACE_ROOT=${WORKSPACE_ROOT:-/data/workspace} \
    KIMI_CLI_NO_AUTO_UPDATE=1

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--", "./kimi-webui"]
