import { Hono } from 'hono';
import { type AuthVariables, requireAdmin, requireAuth } from '../auth/middleware';
import type { DB } from '../db';
import {
  batchUpsert,
  getSessionDefaults as getSiteSessionDefaults,
  readAll,
  SITE_SETTING_KEYS,
} from '../services/site-settings';
import { getSessionDefaults as getUserSessionDefaults } from '../services/user-settings';

const ALL_SITE_KEYS: Set<string> = new Set(Object.values(SITE_SETTING_KEYS));

export interface ConfigSettingsRouterDeps {
  db: DB;
}

export function createConfigSettingsRouter(
  deps: ConfigSettingsRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();

  // GET /settings
  // Admin: list all site settings as {key: value} map.
  router.get('/settings', requireAdmin, async (c) => {
    const map = await readAll(db);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of map) obj[k] = v;
    return c.json(obj);
  });

  // PUT /settings
  // Admin: batch upsert site settings. Body: {settings: [{key, value}]}
  router.put('/settings', requireAdmin, async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (typeof payload !== 'object' || payload === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const { settings } = payload as Record<string, unknown>;
    if (!Array.isArray(settings)) {
      return c.json({ error: 'invalid_settings' }, 400);
    }

    // Validate all keys against the whitelist
    for (const entry of settings) {
      if (typeof entry !== 'object' || entry === null) {
        return c.json({ error: 'invalid_entry' }, 400);
      }
      const { key } = entry as Record<string, unknown>;
      if (typeof key !== 'string' || !ALL_SITE_KEYS.has(key)) {
        return c.json({ error: 'unknown_key', key }, 400);
      }
    }

    await batchUpsert(
      db,
      settings.map((e: { key: string; value: unknown }) => ({ key: e.key, value: e.value })),
    );

    // Return updated state
    const map = await readAll(db);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of map) obj[k] = v;
    return c.json(obj);
  });

  // GET /defaults
  // Auth'd user: merged resolution — user_settings → site_settings → code defaults.
  router.get('/defaults', requireAuth, async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const userId = user.id;
    const [userDefaults, siteDefaults] = await Promise.all([
      getUserSessionDefaults(db, userId),
      getSiteSessionDefaults(db),
    ]);

    return c.json({
      providerId: userDefaults.providerId ?? null,
      model: userDefaults.model ?? null,
      thinking: userDefaults.thinking ?? siteDefaults.thinking,
      approvalMode: userDefaults.approvalMode ?? siteDefaults.approvalMode,
      effort: userDefaults.effort ?? null,
    });
  });

  // GET /defaults/site
  // Admin: site defaults only.
  router.get('/defaults/site', requireAdmin, async (c) => {
    const siteDefaults = await getSiteSessionDefaults(db);
    return c.json(siteDefaults);
  });

  return router;
}
