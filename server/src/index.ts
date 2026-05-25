import { Hono } from 'hono';
import type { HealthResponse } from 'shared/types';
import { auth } from './auth';
import { type AuthVariables, sessionMiddleware } from './auth/middleware';
import { client, db } from './db';
import { env } from './env';
import { auditLog, logger } from './lib/logger';
import filesRoutes from './routes/files';
import { createKimiConfigRouter } from './routes/kimi-config';
import projectsRoutes from './routes/projects';
import { createSessionsRouter } from './routes/sessions';
import { bootstrap } from './services/kimi-config/bootstrap';
import { reconcileOnStartup } from './services/reconcile';
import { sessionManager } from './services/session-manager';
import { SERVICE_VERSION } from './version';
import { handleMessage } from './ws/handlers';
import { startWsHeartbeat } from './ws/heartbeat';
import { registerSocket, snapshot, unregisterSocket } from './ws/registry';
import { handleWsUpgrade, type WSData } from './ws/upgrade';

// Bootstrap: create share dir, seed/load config, render TOML.
const {
  row: kimiConfigRow,
  shareDir: kimiShareDir,
  tomlWritten: kimiTomlWritten,
} = await bootstrap(db);
logger.info(
  {
    provider: kimiConfigRow.provider.type,
    ready: kimiConfigRow.provider.apiKey.length > 0,
    shareDir: kimiShareDir,
    writeTomlMode: env.KIMI_CONFIG_WRITE_TOML,
    tomlWritten: kimiTomlWritten,
  },
  'kimi config bootstrapped',
);

const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', sessionMiddleware);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/health', (c) => {
  const body: HealthResponse = { ok: true, version: SERVICE_VERSION };
  return c.json(body);
});

app.route('/api/files', filesRoutes);
app.route('/api/projects', projectsRoutes);
app.route('/api/sessions', createSessionsRouter({ db, manager: sessionManager, auditLog, env }));
app.route('/api/config', createKimiConfigRouter({ db, shareDir: kimiShareDir }));

await reconcileOnStartup({ db });

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
