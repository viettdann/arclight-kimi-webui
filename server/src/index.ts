import { mkdir } from 'node:fs/promises';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { HealthResponse } from 'shared/types';
import { auth } from './auth';
import { setAccessControlResolver } from './auth/access';
import { type AuthVariables, requireAllowed, sessionMiddleware } from './auth/middleware';
import { createTestLoginRouter } from './auth/test-login';
import { client, db } from './db';
import { env } from './env';
import { auditLog, logger } from './lib/logger';
import { MAX_PROJECT_NAME_LEN } from './lib/slug';
import { createAccessRouter } from './routes/access';
import { createConfigGeneralRouter } from './routes/config-general';
import { createConfigProvidersRouter } from './routes/config-providers';
import { createConfigSettingsRouter } from './routes/config-settings';
import { createConfigSystemRouter } from './routes/config-system';
import { createConfigUserSettingsRouter } from './routes/config-user-settings';
import filesRoutes from './routes/files';
import { createGitRouter } from './routes/git';
import { createGitCredentialsRouter } from './routes/git-credentials';
import { createMeRouter } from './routes/me';
import { createMeProvidersRouter } from './routes/me-providers';
import { createOverviewRouter } from './routes/overview';
import { createProjectDiscoveryRouter } from './routes/project-discovery';
import projectsRoutes from './routes/projects';
import { createProvidersRouter } from './routes/providers';
import { createProvidersAvailableRouter } from './routes/providers-available';
import { createSessionsRouter } from './routes/sessions';
import { ephemeralPaths } from './services/agent/agent-paths';
import { ensureClaudeOnboarding } from './services/agent/onboarding';
import { MAX_ENCODED_LEN } from './services/agent/transcript-store';
import { reconcileOnStartup } from './services/reconcile';
import { sessionManager } from './services/session-manager';
import { resolveAccessControlFromSettings } from './services/site-settings';
import { SERVICE_VERSION } from './version';
import { handleMessage } from './ws/handlers';
import { startWsHeartbeat } from './ws/heartbeat';
import { registerSocket, snapshot, unregisterSocket, size as wsClientSize } from './ws/registry';
import { handleWsUpgrade, type WSData } from './ws/upgrade';

// Worst-case length of a user slug. `slug(email)` slugifies the email local
// part (before `@`) 1:1 — it never changes the length — and RFC 5321 caps the
// local part at 64 characters.
const MAX_USER_SLUG_LEN = 64;

// ─────────────────────────── Bootstrap ───────────────────────────

// Wire up the access control resolver so auth/access.ts reads from site_settings
// instead of the legacy access_control table.
setAccessControlResolver(resolveAccessControlFromSettings);

// ─────────────────────────── Startup ───────────────────────────

// Ensure the two persistent-data roots exist. CLAUDE_CONFIG_DIR is the ROOT for
// per-user agent state (per-user subdirs created lazily on first turn);
// WORKSPACE_ROOT is where per-user project dirs live.
await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
await mkdir(env.WORKSPACE_ROOT, { recursive: true });

// Bootstrap onboarding only for the shared `_ephemeral` config dir (used by
// provider ping + title generation, which carry no user state). Per-user config
// dirs are bootstrapped lazily in `startQuery` on each user's first turn.
await ensureClaudeOnboarding(ephemeralPaths().configDir);

// Encoder self-test (fail-fast). `encodeCwd` only implements the binary's 1:1
// branch (length ≤ MAX_ENCODED_LEN); the hashed-slice fallback would break
// transcript-path parity. A session's workDir is
// `${WORKSPACE_ROOT}/${userSlug}/${projectName}`, so its worst-case length is
// the sum of each segment's cap plus the two path separators. Assert that the
// longest possible workDir still fits the 1:1 branch.
const worstCaseWorkDirLen =
  env.WORKSPACE_ROOT.length + 1 + MAX_USER_SLUG_LEN + 1 + MAX_PROJECT_NAME_LEN;
if (worstCaseWorkDirLen > MAX_ENCODED_LEN) {
  logger.fatal(
    {
      workspaceRoot: env.WORKSPACE_ROOT,
      workspaceRootLen: env.WORKSPACE_ROOT.length,
      worstCaseWorkDirLen,
      maxEncodedLen: MAX_ENCODED_LEN,
      budgetForWorkspaceRoot: MAX_ENCODED_LEN - 1 - MAX_USER_SLUG_LEN - 1 - MAX_PROJECT_NAME_LEN,
    },
    'WORKSPACE_ROOT is too long: a worst-case workDir would exceed the encoder 1:1 ' +
      'branch and break transcript-path parity. Shorten WORKSPACE_ROOT.',
  );
  process.exit(1);
}

const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', sessionMiddleware);
// Test-only login backdoor — must mount BEFORE the `/api/auth/*` wildcard,
// which is first-match-wins and would otherwise swallow this path into
// `auth.handler`. Self-guards via the `x-test-login` token; no-op in prod
// (TEST_LOGIN_ENABLED defaults to 'false').
app.route('/api/auth/test-login', createTestLoginRouter({ db, env }));
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/health', (c) => {
  const body: HealthResponse = { ok: true, version: SERVICE_VERSION };
  return c.json(body);
});

// Allowlist gate on the data-plane prefixes. Registered before their routers
// so it runs ahead of each router's own `requireAuth`. `/api/me` and
// `/api/admin/access` stay ungated here (me must report status to pending
// users; access is admin-only). `/api/me/preferences` is the exception within
// `/api/me`: it writes into the user's workspace, so it gates like data-plane.
app.use('/api/files/*', requireAllowed);
app.use('/api/projects/*', requireAllowed);
app.use('/api/sessions/*', requireAllowed);
app.use('/api/me/preferences', requireAllowed);
app.use('/api/git-credentials/*', requireAllowed);
app.use('/api/git/*', requireAllowed);
app.use('/api/me-providers/*', requireAllowed);
app.use('/api/providers/*', requireAllowed);

const startedAt = new Date();

app.route('/api/me', createMeRouter({ db }));
app.route('/api/admin/access', createAccessRouter({ db }));
app.route(
  '/api/admin/overview',
  createOverviewRouter({ db, manager: sessionManager, wsClientCount: wsClientSize, startedAt }),
);
app.route('/api/files', filesRoutes);
app.route('/api/projects', projectsRoutes);
app.route('/api/sessions', createSessionsRouter({ db, manager: sessionManager, auditLog, env }));
app.route('/api/git-credentials', createGitCredentialsRouter({ db }));
app.route('/api/git', createGitRouter({ db }));
app.route('/api/me-providers', createMeProvidersRouter({ db }));
app.route('/api/providers', createProvidersAvailableRouter({ db }));
app.route('/api/admin/providers', createProvidersRouter({ db }));
app.route('/api/admin/project-discovery', createProjectDiscoveryRouter({ db }));

// ─── Unified config API (new) ──────────────────────────────────────────────
// Allowlist gate on user workspace writes (preferences + git-credentials).
app.use('/api/config/general/preferences', requireAllowed);
app.use('/api/config/general/git-credentials/*', requireAllowed);

app.route('/api/config', createConfigSettingsRouter({ db }));
app.route('/api/config/my-settings', createConfigUserSettingsRouter({ db }));
app.route('/api/config/providers', createConfigProvidersRouter({ db }));
app.route('/api/config/general', createConfigGeneralRouter({ db }));
app.route(
  '/api/config/system',
  createConfigSystemRouter({ db, manager: sessionManager, wsClientCount: wsClientSize, startedAt }),
);

// SPA mount — registered AFTER all /api routes so API paths match earlier
// handlers; the catchall only fires for client-side router paths. Assets are
// served from ./client/dist relative to CWD (the runner copies them there). In
// dev the dir is absent and these fall through — Vite serves the frontend.
app.use('/*', serveStatic({ root: './client/dist' }));
app.get('/*', serveStatic({ root: './client/dist', path: 'index.html' }));

await reconcileOnStartup({ db, env });

const server = Bun.serve<WSData>({
  port: env.PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const result = await handleWsUpgrade(req, srv);
      return result ?? new Response(null, { status: 101 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      registerSocket(ws);
    },
    async message(ws, raw) {
      await handleMessage(ws, raw);
    },
    close(ws) {
      // WS close ≠ session close (invariant #5). Pump keeps running; events
      // accumulate in the per-session ring buffer. Just drop this socket from
      // every wsSet it was attached to, and from the global auth registry.
      unregisterSocket(ws);
      sessionManager.detachAllWS(ws);
    },
  },
});

const stopHeartbeat = startWsHeartbeat();

const SHUTDOWN_TIMEOUT_MS = 5_000;

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  let exitCode = 0;

  try {
    logger.info({ signal }, 'shutting down');
    stopHeartbeat();

    for (const ws of snapshot()) {
      try {
        ws.close(1001, 'server-shutdown');
      } catch {}
    }

    await Promise.race([
      server.stop(),
      new Promise<void>((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS)),
    ]);

    await client.end({ timeout: Math.ceil(SHUTDOWN_TIMEOUT_MS / 1000) });
  } catch (err) {
    logger.error({ err }, 'shutdown error');
    exitCode = 1;
  }

  process.exit(exitCode);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info({ port: server.port, env: env.NODE_ENV }, 'server started');
