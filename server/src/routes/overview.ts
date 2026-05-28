import { count, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { OverviewResponse } from 'shared/types';
import { resolveAccessControl } from '../auth/access';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import type { DB } from '../db';
import { allowedEmail } from '../db/schema';
import type { KimiSessionManager } from '../services/session-manager';

export interface OverviewRouterDeps {
  db: DB;
  manager: Pick<KimiSessionManager, 'size'>;
  wsClientCount: () => number;
  startedAt: Date;
}

export function createOverviewRouter(deps: OverviewRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db, manager, wsClientCount, startedAt } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  router.get('/', async (c) => {
    const [dbHealth, access, allowlistRow] = await Promise.all([
      pingDb(db),
      resolveAccessControl(db),
      db.select({ n: count() }).from(allowedEmail),
    ]);

    const allowlistCount = Number(allowlistRow[0]?.n ?? 0);

    const body: OverviewResponse = {
      runtime: {
        startedAt: startedAt.toISOString(),
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.versions.node,
        // `Bun.version` is the canonical accessor on the bun runtime.
        bunVersion: typeof Bun !== 'undefined' ? Bun.version : '',
      },
      db: dbHealth,
      ws: {
        clients: wsClientCount(),
        sessions: manager.size,
      },
      access: {
        effective: access.effective,
        envDefault: access.envDefault,
        override: access.override,
        allowlistCount,
      },
    };
    return c.json(body);
  });

  return router;
}

async function pingDb(db: DB): Promise<OverviewResponse['db']> {
  const t0 = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return {
      ok: false,
      latencyMs: null,
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}
