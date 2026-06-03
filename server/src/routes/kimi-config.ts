import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  KimiConfigDTO,
  KimiConfigPatchDTO,
  KimiConfigRevealResponse,
  KimiConfigStatusResponse,
  KimiConfigTestRequest,
  KimiConfigTestResponse,
  KimiConfigTomlResponse,
} from 'shared/types';
import { isProviderType, type KimiConfigRow } from 'shared/types/kimi-config';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import type { DB } from '../db';
import { kimiConfig } from '../db/schema';
import { getKimiConfig } from '../services/kimi-config/get-kimi-config';
import { maskConfigDTO } from '../services/kimi-config/mask';
import { resolveShareDir } from '../services/kimi-config/share-dir';
import { computeConfigStatus } from '../services/kimi-config/status';
import { type FetchFn, testConnection } from '../services/kimi-config/test-connection';
import { writeConfigToml } from '../services/kimi-config/write-toml';
import { clearSlashCommandsCache } from '../services/slash-commands-cache';

export interface KimiConfigRouterDeps {
  db: DB;
  /** Forwarded to write-toml. Defaults to `resolveShareDir()`. */
  shareDir?: string;
  /** Override the fetch used by POST /test. Defaults to global `fetch`. */
  fetchFn?: FetchFn;
}

function applyPatch(row: KimiConfigRow, patch: KimiConfigPatchDTO): KimiConfigRow {
  const next: KimiConfigRow = {
    ...row,
    defaults: patch.defaults ? { ...row.defaults, ...patch.defaults } : row.defaults,
    provider: patch.provider
      ? {
          ...row.provider,
          ...patch.provider,
          apiKey:
            patch.provider.apiKey === null
              ? row.provider.apiKey
              : (patch.provider.apiKey ?? row.provider.apiKey),
        }
      : row.provider,
    models: patch.models ? { ...row.models, ...patch.models } : row.models,
    services: patch.services ? { ...row.services, ...patch.services } : row.services,
    loopControl: patch.loopControl ? { ...row.loopControl, ...patch.loopControl } : row.loopControl,
    background: patch.background ? { ...row.background, ...patch.background } : row.background,
    notifications: patch.notifications
      ? { ...row.notifications, ...patch.notifications }
      : row.notifications,
    mcpClient: patch.mcpClient ? { ...row.mcpClient, ...patch.mcpClient } : row.mcpClient,
    hooks: patch.hooks ?? row.hooks,
    extraTomlOverride: patch.extraTomlOverride ?? row.extraTomlOverride,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export function createKimiConfigRouter(
  deps: KimiConfigRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;

  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  router.get('/', async (c) => {
    const row = await getKimiConfig(db);
    const dto: KimiConfigDTO = maskConfigDTO(row);
    return c.json(dto);
  });

  router.get('/status', async (c) => {
    const row = await getKimiConfig(db);
    const status: KimiConfigStatusResponse = computeConfigStatus(row);
    return c.json(status);
  });

  router.post('/test', async (c) => {
    const row = await getKimiConfig(db);

    // Body is optional. When present, treat it as an override of the in-memory
    // edits the user has not yet saved. Same apiKey rule as PATCH:
    //   provider.apiKey === null (or omitted) → keep persisted key.
    let body: KimiConfigTestRequest = {};
    try {
      const raw = await c.req.text();
      if (raw.length > 0) body = JSON.parse(raw) as KimiConfigTestRequest;
    } catch {
      return c.json({ ok: false, error: 'invalid_body' } satisfies KimiConfigTestResponse);
    }
    if (body.provider?.type !== undefined && !isProviderType(body.provider.type)) {
      return c.json({ ok: false, error: 'invalid_provider_type' } satisfies KimiConfigTestResponse);
    }

    const merged: KimiConfigRow = body.provider
      ? {
          ...row,
          provider: {
            ...row.provider,
            ...body.provider,
            apiKey:
              body.provider.apiKey === null || body.provider.apiKey === undefined
                ? row.provider.apiKey
                : body.provider.apiKey,
          },
        }
      : row;

    const result = await testConnection(merged, deps.fetchFn);
    const response: KimiConfigTestResponse = result;
    return c.json(response);
  });

  router.get('/reveal-api-key', async (c) => {
    const row = await getKimiConfig(db);
    const response: KimiConfigRevealResponse = { apiKey: row.provider.apiKey };
    return c.json(response);
  });

  router.get('/toml', async (c) => {
    const dir = deps.shareDir ?? resolveShareDir();
    const tomlPath = path.join(dir, 'config.toml');
    try {
      const content = readFileSync(tomlPath, 'utf8');
      const response: KimiConfigTomlResponse = { content, exists: true, path: tomlPath };
      return c.json(response);
    } catch {
      const response: KimiConfigTomlResponse = { content: '', exists: false, path: tomlPath };
      return c.json(response);
    }
  });

  // Force-render .kimi/config.toml from the current DB row. Useful when the
  // boot-time write policy is 'never' / 'if-missing' and the on-disk file has
  // drifted from DB.
  router.post('/sync-toml', async (c) => {
    const row = await getKimiConfig(db);
    writeConfigToml(row, deps.shareDir);
    return c.json({ ok: true });
  });

  router.patch('/', async (c) => {
    const body = (await c.req.json()) as KimiConfigPatchDTO;

    // Validate provider.type if present
    if (body.provider?.type !== undefined && !isProviderType(body.provider.type)) {
      return c.json({ error: 'invalid_provider_type' }, 400);
    }

    // Fold effective config (DB > env > defaults) into the patch. On an empty
    // DB this materialises env-derived values plus the patch in a single upsert
    // — the singleton `kimi_config_singleton` check pins id=1.
    const current = await getKimiConfig(db);
    const next = applyPatch(current, body);

    const values = {
      id: 1,
      defaults: next.defaults,
      provider: next.provider,
      models: next.models,
      services: next.services,
      loopControl: next.loopControl,
      background: next.background,
      notifications: next.notifications,
      mcpClient: next.mcpClient,
      hooks: next.hooks,
      extraTomlOverride: next.extraTomlOverride,
      updatedAt: new Date(next.updatedAt),
    };
    const { id: _id, ...updatable } = values;
    await db
      .insert(kimiConfig)
      .values(values)
      .onConflictDoUpdate({ target: kimiConfig.id, set: updatable });

    // Re-render TOML file after update
    writeConfigToml(next, deps.shareDir);

    // Editing skills/config can change the available command list; drop the
    // cache so the next warm-init probe rebuilds it.
    clearSlashCommandsCache();

    const dto: KimiConfigDTO = maskConfigDTO(next);
    return c.json(dto);
  });

  return router;
}
