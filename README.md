# Kimi WebUI

Rảnh rỗi sinh nông nỗi — tôi đăng ký gói Allegretto bên Kimi rồi tự hỏi "giờ làm gì với nó". Câu trả lời là build thêm một WebUI nữa cho Kimi, dù bản chính thức và `kimi-cli` đều đã có sẵn. Đúng kiểu rỗi việc làm lại cái đã có.

Bản web mặc định của Kimi dùng nội bộ thì ổn, đem ra internet thì tôi chưa yên tâm: phần đăng nhập đơn sơ, session lưu rời rạc, đổi máy hay đổi browser một cái là gần như mất ngữ cảnh hội thoại. Bản này gom hết — tài khoản, hội thoại, file — vào đúng một Postgres. Server bật lên là từ máy nào cũng vào tiếp được, không phải mò vào VPS để cứu chat hôm qua.

Agent chạy server-side qua `@moonshot-ai/kimi-agent-sdk`, stream event về client qua WebSocket. Multi-user, self-hosted.

## Stack

- **Runtime:** Bun `1.3.13`
- **Monorepo:** Bun workspaces + Turbo
- **BE:** Hono, Kimi Agent SDK, Drizzle + postgres-js, BetterAuth (MVP-3), pino, zod
- **FE:** Vite + React 19, Tailwind v4, shadcn/ui, TanStack Query, Zustand

Layout: `server/`, `client/`, `shared/`.

## Prerequisites (host)

- [Bun](https://bun.sh) `>= 1.3.13` (`bun upgrade` if older)
- `git`
- [`uv`](https://docs.astral.sh/uv/) — required by Kimi CLI
- PostgreSQL (external, SSL); CA cert at `./certs/ca.crt`

```sh
which bun git uv
bun --version  # must be >= 1.3.13
```

## Setup

```sh
cp .env.example .env                                    # fill in DATABASE_URL, BetterAuth/Azure (MVP-3)
bun install                                             # installs all workspaces + lockfile
bun run db:generate --name <semantic_name>              # emits SQL into server/src/db/migrations
bun run db:migrate                                      # apply to your dev DB
```

> `db:generate` enforces `--name <semantic_name>`. Use snake_case verbs that describe the change
> (e.g. `--name initial_sessions`, `--name add_auth_tables`, `--name add_session_archived_flag`).
> The wrapper at `server/scripts/db-generate.ts` rejects calls without `--name` so we never end up
> with auto-named files like `0001_aimless_namor.sql`.

## Develop

```sh
bun run dev                # turbo runs server + client in parallel
# or individually:
bun run dev:server         # http://localhost:3000  (Hono + WS)
bun run dev:client         # http://localhost:5173  (Vite, proxies /api + /ws)
```

Health check: `curl http://localhost:3000/api/health` → `{ "ok": true, "version": "0.0.0" }`.

## Verify

```sh
bun run check              # biome check (lint + format) + tsc per workspace — CI gate
bun run fix                # biome check --write + tsc — autofix anything fixable
bun run build              # server + client production build
bun --filter server test   # bun:test (placeholder it.todo specs at bootstrap)
```

## Scripts (root)

| Script | Does |
|--------|------|
| `bun run dev` | `turbo run dev` (persistent, server + client) |
| `bun run dev:server` / `dev:client` | run one workspace |
| `bun run build` | `turbo run build` (bun build + vite build) |
| `bun run check` | `biome check . && turbo run check` — full CI gate (lint + format + types) |
| `bun run fix` | `biome check --write . && turbo run check` — autofix + verify |
| `bun run typecheck` | `turbo run check` — tsc only |
| `bun run lint` / `lint:fix` | biome lint, optionally writing fixes |
| `bun run format` / `format:fix` | biome format, optionally writing fixes |
| `bun run test` | `turbo run test` |
| `bun run db:generate -- --name <semantic>` | wrapper enforces `--name`; emits SQL into `server/src/db/migrations` |
| `bun run db:migrate` / `db:studio` | drizzle-kit |

Server scripts read env from project root via `bun --env-file=../.env`.
Client/Vite reads its own `.env` (only `VITE_*` keys exposed to the browser).

`KIMI_SHARE_DIR` (default `./.runtime/kimi`) isolates the webui's Kimi state — `config.toml`, `oauth/`, `sessions/`, `logs/` — from your host `~/.kimi`. Running `kimi` in a terminal still uses `~/.kimi` as before.

## Out of scope (MVP build order, see `docs/plans/2026-04-30-kimi-webui-design.md`)

- BetterAuth + Azure SSO (MVP-3)
- Kimi SDK wrapper, backup/restore (MVP-4)
- WS handlers, EventBuffer, replay (MVP-5)
- Path-guard impl + tests, File API (MVP-6)
- shadcn components, full UI (UI track)
- Container / Dockerfile / compose
