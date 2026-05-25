import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type {
  KimiConfigDTO,
  KimiConfigPatchDTO,
  KimiConfigStatusResponse,
  KimiConfigTestResponse,
} from 'shared/types';
import type { KimiConfigRow } from 'shared/types/kimi-config';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import type { DB } from '../db';
import { kimiConfig } from '../db/schema';
import { loadOrSeed } from '../services/kimi-config/load-or-seed';
import { maskConfigDTO } from '../services/kimi-config/mask';
import { computeConfigStatus } from '../services/kimi-config/status';
import { type FetchFn, testConnection } from '../services/kimi-config/test-connection';
import { writeConfigToml } from '../services/kimi-config/write-toml';

export interface KimiConfigRouterDeps {
  db: DB;
  /** Forwarded to write-toml. Defaults to `resolveShareDir()`. */
  shareDir?: string;
  /** Override the fetch used by POST /test. Defaults to global `fetch`. */
  fetchFn?: FetchFn;
}

function isValidProviderType(t: string): t is KimiConfigRow['provider']['type'] {
  return ['kimi', 'openai_legacy', 'openai_responses', 'anthropic', 'gemini', 'vertexai'].includes(
    t,
  );
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
    const row = await loadOrSeed(db);
    const dto: KimiConfigDTO = maskConfigDTO(row);
    return c.json(dto);
  });

  router.get('/status', async (c) => {
    const row = await loadOrSeed(db);
    const status: KimiConfigStatusResponse = computeConfigStatus(row);
    return c.json(status);
  });

  router.post('/test', async (c) => {
    const row = await loadOrSeed(db);
    const result = await testConnection(row, deps.fetchFn);
    const response: KimiConfigTestResponse = result;
    return c.json(response);
  });

  router.patch('/', async (c) => {
    const body = (await c.req.json()) as KimiConfigPatchDTO;

    // Validate provider.type if present
    if (body.provider?.type !== undefined && !isValidProviderType(body.provider.type)) {
      return c.json({ error: 'invalid_provider_type' }, 400);
    }

    const current = await loadOrSeed(db);
    const next = applyPatch(current, body);

    await db
      .update(kimiConfig)
      .set({
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
      })
      .where(eq(kimiConfig.id, 1));

    // Re-render TOML file after update
    writeConfigToml(next, deps.shareDir);

    const dto: KimiConfigDTO = maskConfigDTO(next);
    return c.json(dto);
  });

  return router;
}
