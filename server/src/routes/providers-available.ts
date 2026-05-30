import { Hono } from 'hono';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { listAvailableForUser } from '../services/providers/resolve';

export interface ProvidersAvailableRouterDeps {
  db: DB;
}

export function createProvidersAvailableRouter(
  deps: ProvidersAvailableRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // ─────────────────────────── GET /available ───────────────────────────

  router.get('/available', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return c.json(await listAvailableForUser(db, user.id));
  });

  return router;
}

export default createProvidersAvailableRouter({ db: defaultDb });
