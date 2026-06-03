import { eq } from 'drizzle-orm';
import { isProviderType, type KimiConfigRow, type ProviderType } from 'shared/types/kimi-config';
import type { DB } from '../../db';
import { kimiConfig } from '../../db/schema';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import { DEFAULT_KIMI_CONFIG } from './defaults';

// Read the singleton kimi_config row. Never writes. Never throws on a missing
// row — the underlying SELECT may still throw on DB connectivity errors, which
// callers wrap if they want best-effort behavior.
//
// Resolution priority (per-field): DB row > env vars > DEFAULT_KIMI_CONFIG.
//
// `env`-derived values are only consulted when the DB has no row at all; once
// PATCH /api/config writes the row, the DB is the sole source of truth.

function mapRow(row: {
  id: number;
  defaults: unknown;
  provider: unknown;
  models: unknown;
  services: unknown;
  loopControl: unknown;
  background: unknown;
  notifications: unknown;
  mcpClient: unknown;
  hooks: unknown;
  extraTomlOverride: string;
  updatedAt: Date;
}): KimiConfigRow {
  const rawProvider = row.provider as KimiConfigRow['provider'];
  // Defensive coercion for legacy rows persisted under the old enum
  // (gemini / vertexai). Clone instead of mutating the raw row in place so
  // callers that retain references to the source object aren't surprised.
  let provider = rawProvider;
  if (rawProvider && !isProviderType(rawProvider.type)) {
    logger.warn(
      { legacyType: rawProvider.type },
      'kimi-config: legacy provider.type coerced to kimi on read',
    );
    provider = { ...rawProvider, type: 'kimi' };
  }
  return {
    id: row.id,
    defaults: row.defaults as KimiConfigRow['defaults'],
    provider,
    models: row.models as KimiConfigRow['models'],
    services: row.services as KimiConfigRow['services'],
    loopControl: row.loopControl as KimiConfigRow['loopControl'],
    background: row.background as KimiConfigRow['background'],
    notifications: row.notifications as KimiConfigRow['notifications'],
    mcpClient: row.mcpClient as KimiConfigRow['mcpClient'],
    hooks: row.hooks as KimiConfigRow['hooks'],
    extraTomlOverride: row.extraTomlOverride,
    updatedAt:
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date().toISOString(),
  };
}

// Fill in scalar/sub-block fields the DB row lacks (older row inserted before
// the schema gained a field). Only adds, never overwrites — every key already
// present on the row is preserved verbatim. In-memory only; never writes back.
function fillMissingFromDefaults(row: KimiConfigRow): KimiConfigRow {
  function merge<T extends object>(existing: T, defaults: T): T {
    const existingObj = existing as Record<string, unknown>;
    const defaultsObj = defaults as Record<string, unknown>;
    const out: Record<string, unknown> = { ...existingObj };
    for (const [k, v] of Object.entries(defaultsObj)) {
      if (!(k in existingObj)) {
        out[k] = v;
      }
    }
    return out as T;
  }

  return {
    ...row,
    defaults: merge(row.defaults, DEFAULT_KIMI_CONFIG.defaults),
    provider: merge(row.provider, DEFAULT_KIMI_CONFIG.provider),
    services: merge(row.services, DEFAULT_KIMI_CONFIG.services),
    loopControl: merge(row.loopControl, DEFAULT_KIMI_CONFIG.loopControl),
    background: merge(row.background, DEFAULT_KIMI_CONFIG.background),
    notifications: merge(row.notifications, DEFAULT_KIMI_CONFIG.notifications),
    mcpClient: merge(row.mcpClient, DEFAULT_KIMI_CONFIG.mcpClient),
  };
}

function buildPartialFromEnv(): Partial<KimiConfigRow> {
  const seed: Partial<KimiConfigRow> = {};

  if (env.KIMI_PROVIDER_TYPE !== undefined && isProviderType(env.KIMI_PROVIDER_TYPE)) {
    const type: ProviderType = env.KIMI_PROVIDER_TYPE;
    seed.provider = {
      ...(seed.provider ?? {}),
      type,
    } as KimiConfigRow['provider'];
  }

  if (env.KIMI_BASE_URL !== undefined) {
    seed.provider = {
      ...(seed.provider ?? {}),
      baseUrl: env.KIMI_BASE_URL,
    } as KimiConfigRow['provider'];
  }

  if (env.KIMI_API_KEY !== undefined) {
    seed.provider = {
      ...(seed.provider ?? {}),
      apiKey: env.KIMI_API_KEY,
    } as KimiConfigRow['provider'];
  }

  const defaultModelKey = env.KIMI_DEFAULT_MODEL;
  if (defaultModelKey !== undefined) {
    const defaultEntry = DEFAULT_KIMI_CONFIG.models[DEFAULT_KIMI_CONFIG.defaults.model];

    seed.defaults = {
      ...(seed.defaults ?? {}),
      model: defaultModelKey,
    } as KimiConfigRow['defaults'];

    const modelEntry: KimiConfigRow['models'][string] = {
      provider: env.KIMI_MODEL_PROVIDER ?? defaultEntry?.provider ?? '',
      model: env.KIMI_MODEL_NAME ?? defaultEntry?.model ?? '',
      maxContextSize: env.KIMI_MODEL_MAX_CONTEXT_SIZE
        ? parseInt(env.KIMI_MODEL_MAX_CONTEXT_SIZE, 10)
        : (defaultEntry?.maxContextSize ?? 0),
      capabilities: env.KIMI_MODEL_CAPABILITIES
        ? (env.KIMI_MODEL_CAPABILITIES.split(
            ',',
          ) as KimiConfigRow['models'][string]['capabilities'])
        : (defaultEntry?.capabilities ?? []),
    };

    const displayName = env.KIMI_MODEL_DISPLAY_NAME ?? defaultEntry?.displayName;
    if (displayName !== undefined) {
      modelEntry.displayName = displayName;
    }

    seed.models = {
      ...(seed.models ?? {}),
      [defaultModelKey]: modelEntry,
    };
  }

  return seed;
}

function mergeWithDefaults(seed: Partial<KimiConfigRow>): KimiConfigRow {
  return {
    ...DEFAULT_KIMI_CONFIG,
    ...seed,
    defaults: { ...DEFAULT_KIMI_CONFIG.defaults, ...seed.defaults },
    provider: { ...DEFAULT_KIMI_CONFIG.provider, ...seed.provider },
    models: { ...DEFAULT_KIMI_CONFIG.models, ...seed.models },
    services: { ...DEFAULT_KIMI_CONFIG.services, ...seed.services },
    loopControl: { ...DEFAULT_KIMI_CONFIG.loopControl, ...seed.loopControl },
    background: { ...DEFAULT_KIMI_CONFIG.background, ...seed.background },
    notifications: { ...DEFAULT_KIMI_CONFIG.notifications, ...seed.notifications },
    mcpClient: { ...DEFAULT_KIMI_CONFIG.mcpClient, ...seed.mcpClient },
    hooks: seed.hooks ?? DEFAULT_KIMI_CONFIG.hooks,
    extraTomlOverride: seed.extraTomlOverride ?? DEFAULT_KIMI_CONFIG.extraTomlOverride,
    updatedAt: new Date().toISOString(),
  };
}

export async function getKimiConfig(db: DB): Promise<KimiConfigRow> {
  const existing = await db.select().from(kimiConfig).where(eq(kimiConfig.id, 1)).limit(1);

  const existingRow = existing[0];
  if (existingRow) {
    return fillMissingFromDefaults(mapRow(existingRow));
  }

  return mergeWithDefaults(buildPartialFromEnv());
}
