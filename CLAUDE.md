# arclight-kimi-webui

## Working rules

**`docs/` is the user's personal works.** Design notes, plans, drafts. Never proactively stage anything under `docs/` in commits, The user will commit it themselves if needed. Production source of truth lives in code.

**Documentation is imperative, not narrative.** When writing or updating plans, specs, or any doc: state what to do, not why it was chosen, not what it replaced, not what was tried before. Reader executes from the doc; rationale and changelog are noise.

**Pick and move.** Don't enumerate alternatives when one was already requested. Don't pre-emptively propose options for decisions the user hasn't asked about. If a default is reasonable, take it; surface only blockers and genuine ambiguity.

**Single deployment, single server.** Roles (server, worker migrate,...) may run as separate binaries or containers, but each role runs as exactly one instance — no horizontal scaling, no replicas of the same role. No leader election, no cross-instance coordination, no read replicas, no sharding. WebSocket state is in-memory. Reconcile-on-startup runs unconditionally. Never propose designs that assume multi-instance of any role.

**Infra and CI are out of scope.** Don't ask about Docker, Kubernetes, CI/CD pipelines, deployment targets, or hosting. Postgres, Redis, and any binaries are user-managed externally. Code targets `bun` runtime; that's the only deployment assumption permitted.

## Testing

Run server tests in **isolated mode by default**: each `test/**/*.test.ts` file spawns its own `bun test` subprocess via `server/scripts/run-isolated-tests.ts`. One file = one Bun runtime, so module state, singletons (DB pool, `setHandlerDeps`, in-memory caches), and `process.env` mutations never bleed across files.

- `bun --filter server test` — isolated (default, also what `turbo run test` invokes)
- `bun --filter server run test:bundled` — single-process `bun test`, faster, use for debugging only

Preload `server/test/setup.ts` (stub env) applies to both modes via root `bunfig.toml`. When adding new tests, place them under `server/test/**/*.test.ts` — the isolated runner picks them up automatically. Do not introduce cross-file test ordering assumptions; if a test only passes in bundled mode, fix the test, not the runner.