import { Hono } from 'hono';
import type { ProjectDiscoverySettingsResponse } from 'shared/types';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import type { DB } from '../db';
import { getProjectDiscoveryConfig, setProjectDiscoveryConfig } from '../services/site-settings';

export interface ProjectDiscoveryRouterDeps {
  db: DB;
}

/**
 * Admin-only site-wide project discovery blacklist. Backed by the generic
 * `site_settings` table (two rows). Reads fall back to code defaults when no
 * rows exist; nothing is seeded.
 */
export function createProjectDiscoveryRouter(
  deps: ProjectDiscoveryRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  // GET /api/admin/project-discovery
  router.get('/', async (c) => {
    const { entries, override } = await getProjectDiscoveryConfig(db);
    const body: ProjectDiscoverySettingsResponse = { entries, override };
    return c.json(body);
  });

  // PUT /api/admin/project-discovery
  router.put('/', async (c) => {
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

    const body: ProjectDiscoverySettingsResponse = config;
    return c.json(body);
  });

  return router;
}
