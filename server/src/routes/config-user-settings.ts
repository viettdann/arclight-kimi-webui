import { Hono } from 'hono';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import type { DB } from '../db';
import { batchUpsert, readAll, USER_SETTING_KEYS } from '../services/user-settings';

const ALL_USER_KEYS: Set<string> = new Set(Object.values(USER_SETTING_KEYS));

export interface ConfigUserSettingsRouterDeps {
  db: DB;
}

export function createConfigUserSettingsRouter(
  deps: ConfigUserSettingsRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();

  // ─────────────────────────── GET / ───────────────────────────
  // Auth'd user: list own user settings.
  router.get('/', requireAuth, async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const map = await readAll(db, user.id);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of map) obj[k] = v;
    return c.json(obj);
  });

  // ─────────────────────────── PUT / ───────────────────────────
  // Auth'd user: batch upsert own user settings. Body: {settings: [{key, value}]}
  router.put('/', requireAuth, async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

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
      if (typeof key !== 'string' || !ALL_USER_KEYS.has(key)) {
        return c.json({ error: 'unknown_key', key }, 400);
      }
    }

    await batchUpsert(
      db,
      settings.map((e: { key: string; value: unknown }) => ({ key: e.key, value: e.value })),
      user.id,
    );

    // Return updated state
    const map = await readAll(db, user.id);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of map) obj[k] = v;
    return c.json(obj);
  });

  return router;
}
