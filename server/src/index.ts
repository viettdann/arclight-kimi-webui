import { Hono } from 'hono';
import type { HealthResponse } from 'shared/types';
import { auth } from './auth';
import { type AuthVariables, sessionMiddleware } from './auth/middleware';
import { env } from './env';
import { logger } from './lib/logger';
import filesRoutes from './routes/files';
import sessionsRoutes from './routes/sessions';
import { handleWsUpgrade, type WSData } from './ws/upgrade';

const SERVICE_VERSION = '0.0.0';

const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', sessionMiddleware);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/health', (c) => {
  const body: HealthResponse = { ok: true, version: SERVICE_VERSION };
  return c.json(body);
});

app.route('/api/files', filesRoutes);
app.route('/api/sessions', sessionsRoutes);

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
    message() {
      // Handlers land at MVP-5.
    },
  },
});

logger.info({ port: server.port, env: env.NODE_ENV }, 'server started');
