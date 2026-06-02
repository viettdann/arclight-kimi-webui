import { count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type {
  AccessControlResponse,
  AllowedEmailDTO,
  AllowlistResponse,
  OverviewResponse,
} from 'shared/types';
import { normalizeEmail, resolveAccessControl } from '../auth/access';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import type { DB } from '../db';
import { allowedEmail } from '../db/schema';
import { env } from '../env';
import { SITE_SETTING_KEYS, batchUpsert } from '../services/site-settings';
import {
  getProjectDiscoveryConfig,
  setProjectDiscoveryConfig,
} from '../services/site-settings';
import type { SessionManager } from '../services/session-manager';

// Pragmatic single-address check; SSO already vouches for the address, this
// only guards against obvious typos in the admin input.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toAllowedEmailDTO = (row: { email: string; createdAt: Date }): AllowedEmailDTO => ({
  email: row.email,
  createdAt: row.createdAt.toISOString(),
});

export interface ConfigSystemRouterDeps {
  db: DB;
  manager: Pick<SessionManager, 'size'>;
  wsClientCount: () => number;
  startedAt: Date;
}

export function createConfigSystemRouter(
  deps: ConfigSystemRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db, manager, wsClientCount, startedAt } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  // ─────────────────────────── GET /allowlist ───────────────────────────

  router.get('/allowlist', async (c) => {
    const rows = await db
      .select({ email: allowedEmail.email, createdAt: allowedEmail.createdAt })
      .from(allowedEmail)
      .orderBy(desc(allowedEmail.createdAt));
    const body: AllowlistResponse = { emails: rows.map(toAllowedEmailDTO) };
    return c.json(body);
  });

  // ─────────────────────────── POST /allowlist ───────────────────────────

  router.post('/allowlist', async (c) => {
    const { email } = (await c.req.json()) as { email?: unknown };
    const normalized = typeof email === 'string' ? normalizeEmail(email) : '';
    if (!EMAIL_RE.test(normalized)) {
      return c.json({ error: 'invalid_email' }, 400);
    }
    await db.insert(allowedEmail).values({ email: normalized }).onConflictDoNothing();
    const [row] = await db
      .select({ email: allowedEmail.email, createdAt: allowedEmail.createdAt })
      .from(allowedEmail)
      .where(eq(allowedEmail.email, normalized))
      .limit(1);
    const dto: AllowedEmailDTO = toAllowedEmailDTO(
      row ?? { email: normalized, createdAt: new Date() },
    );
    return c.json(dto);
  });

  // ─────────────────────────── DELETE /allowlist/:email ───────────────────────────

  router.delete('/allowlist/:email', async (c) => {
    await db
      .delete(allowedEmail)
      .where(eq(allowedEmail.email, normalizeEmail(c.req.param('email'))));
    return c.json({ ok: true });
  });

  // ─────────────────────────── GET /control ───────────────────────────

  router.get('/control', async (c) => {
    const { override, envDefault, effective } = await resolveAccessControl(db);
    const body: AccessControlResponse = { override, envDefault, effective };
    return c.json(body);
  });

  // ─────────────────────────── PATCH /control ───────────────────────────
  // Write to site_settings.access.enabled instead of access_control table.
  // null = use env default (delete row), boolean = override.

  router.patch('/control', async (c) => {
    const { override } = (await c.req.json()) as { override?: unknown };
    if (override !== null && typeof override !== 'boolean') {
      return c.json({ error: 'invalid_override' }, 400);
    }

    // Write to site_settings: null → delete (use env default), boolean → upsert
    await batchUpsert(db, [{ key: SITE_SETTING_KEYS.accessEnabled, value: override }]);

    const envDefault = env.ACCESS_CONTROL_ENABLED === 'true';
    const body: AccessControlResponse = { override, envDefault, effective: override ?? envDefault };
    return c.json(body);
  });

  // ─────────────────────────── GET /project-discovery ───────────────────────────

  router.get('/project-discovery', async (c) => {
    const { entries, override } = await getProjectDiscoveryConfig(db);
    return c.json({ entries, override });
  });

  // ─────────────────────────── PUT /project-discovery ───────────────────────────

  router.put('/project-discovery', async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (typeof payload !== 'object' || payload === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const { entries, override } = payload as Record<string, unknown>;

    if (typeof override !== 'boolean') {
      return c.json({ error: 'invalid_override' }, 400);
    }
    if (!Array.isArray(entries) || !entries.every((e) => typeof e === 'string')) {
      return c.json({ error: 'invalid_entries' }, 400);
    }

    const config = { entries: entries as string[], override };
    await setProjectDiscoveryConfig(db, config);

    return c.json(config);
  });

  // ─────────────────────────── GET /overview ───────────────────────────

  router.get('/overview', async (c) => {
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
