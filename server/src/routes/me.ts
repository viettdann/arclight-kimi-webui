import { Hono } from 'hono';
import type { MeResponse } from 'shared/types';
import { canUserAccess } from '../auth/access';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import type { DB } from '../db';

export interface MeRouterDeps {
  db: DB;
}

export function createMeRouter(deps: MeRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  router.get('/', async (c) => {
    // requireAuth guarantees a non-null user.
    const user = c.var.user as NonNullable<AuthVariables['user']> & { role?: string };
    const body: MeResponse = {
      role: user.role === 'admin' ? 'admin' : 'user',
      allowed: await canUserAccess(db, user),
    };
    return c.json(body);
  });

  return router;
}
