# arclight-mtc-webui

## Working rules

**`docs/` is the user's personal works.** Design notes, plans, drafts. Never proactively stage anything under `docs/` in commits, The user will commit it themselves if needed. Production source of truth lives in code.

**Documentation is imperative, not narrative.** When writing or updating plans, specs, or any doc: state what to do, not why it was chosen, not what it replaced, not what was tried before. Reader executes from the doc; rationale and changelog are noise.

**Pick and move.** Don't enumerate alternatives when one was already requested. Don't pre-emptively propose options for decisions the user hasn't asked about. If a default is reasonable, take it; surface only blockers and genuine ambiguity.

**Single deployment, single server.** Roles (server, worker migrate,...) may run as separate binaries or containers, but each role runs as exactly one instance — no horizontal scaling, no replicas of the same role. No leader election, no cross-instance coordination, no read replicas, no sharding. WebSocket state is in-memory. Reconcile-on-startup runs unconditionally. Never propose designs that assume multi-instance of any role.

**Infra and CI are out of scope.** Don't ask about Docker, Kubernetes, CI/CD pipelines, deployment targets, or hosting. Postgres, Redis, and any binaries are user-managed externally. Code targets `bun` runtime; that's the only deployment assumption permitted.

## Testing

Server tests run **isolated only**: each `test/**/*.test.ts` file spawns its own `bun test` subprocess via `server/scripts/run-isolated-tests.ts`. One file = one Bun runtime, so module state, singletons (DB pool, `setHandlerDeps`, in-memory caches), `mock.module` registrations, and `process.env` mutations never bleed across files. Per-file wall-clock timeout is 30s; per-test timeout is 5s.

- `bun --filter server test` — full suite (also what `turbo run test` invokes)
- `bun test server/test/path/to/file.test.ts` — single file, for debugging only

Never invoke `bun test` without a specific file path. The bundled scan loads every `*.test.ts` into one process, which breaks the isolation invariants above and hangs on teardown.

Preload `server/test/setup.ts` (stub env) applies via root `bunfig.toml`. Place new tests under `server/test/**/*.test.ts`; the isolated runner picks them up automatically. Tests must be order-independent — never rely on side effects from a previously executed file.