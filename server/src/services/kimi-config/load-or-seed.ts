import { eq } from 'drizzle-orm';
import type { KimiConfigRow } from 'shared/types/kimi-config';
import type { DB } from '../../db';
import { kimiConfig } from '../../db/schema';
import { DEFAULT_KIMI_CONFIG } from './defaults';
import { seedFromEnv } from './seed-from-env';

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

// Fill in scalar/sub-block fields that DEFAULT_KIMI_CONFIG defines but `row`
// is missing (older row inserted before the schema gained a field, or with a
// partial seed). Preserves every key already present on `row` verbatim — we
// only add, never overwrite. Returns the reconciled row and whether anything
// was added.
function reconcileWithDefaults(row: KimiConfigRow): { row: KimiConfigRow; changed: boolean } {
  let changed = false;
  function merge<T extends object>(existing: T, defaults: T): T {
    const existingObj = existing as Record<string, unknown>;
    const defaultsObj = defaults as Record<string, unknown>;
    const out: Record<string, unknown> = { ...existingObj };
    for (const [k, v] of Object.entries(defaultsObj)) {
      if (!(k in existingObj)) {
        out[k] = v;
        changed = true;
      }
    }
    return out as T;
  }

  const next: KimiConfigRow = {
    ...row,
    defaults: merge(row.defaults, DEFAULT_KIMI_CONFIG.defaults),
    provider: merge(row.provider, DEFAULT_KIMI_CONFIG.provider),
    services: merge(row.services, DEFAULT_KIMI_CONFIG.services),
    loopControl: merge(row.loopControl, DEFAULT_KIMI_CONFIG.loopControl),
    background: merge(row.background, DEFAULT_KIMI_CONFIG.background),
    notifications: merge(row.notifications, DEFAULT_KIMI_CONFIG.notifications),
    mcpClient: merge(row.mcpClient, DEFAULT_KIMI_CONFIG.mcpClient),
  };
  return { row: next, changed };
}

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
  return {
    id: row.id,
    defaults: row.defaults as KimiConfigRow['defaults'],
    provider: row.provider as KimiConfigRow['provider'],
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

export async function loadOrSeed(db: DB): Promise<KimiConfigRow> {
  const existing = await db.select().from(kimiConfig).where(eq(kimiConfig.id, 1)).limit(1);

  const existingRow = existing[0];
  if (existingRow) {
    const mapped = mapRow(existingRow);
    const { row: reconciled, changed } = reconcileWithDefaults(mapped);
    if (changed) {
      reconciled.updatedAt = new Date().toISOString();
      await db
        .update(kimiConfig)
        .set({
          defaults: reconciled.defaults,
          provider: reconciled.provider,
          services: reconciled.services,
          loopControl: reconciled.loopControl,
          background: reconciled.background,
          notifications: reconciled.notifications,
          mcpClient: reconciled.mcpClient,
          updatedAt: new Date(reconciled.updatedAt),
        })
        .where(eq(kimiConfig.id, 1));
    }
    return reconciled;
  }

  const seed = seedFromEnv();
  const merged = mergeWithDefaults(seed);

  const inserted = await db
    .insert(kimiConfig)
    .values({
      id: 1,
      defaults: merged.defaults,
      provider: merged.provider,
      models: merged.models,
      services: merged.services,
      loopControl: merged.loopControl,
      background: merged.background,
      notifications: merged.notifications,
      mcpClient: merged.mcpClient,
      hooks: merged.hooks,
      extraTomlOverride: merged.extraTomlOverride,
      updatedAt: new Date(merged.updatedAt),
    })
    .returning();

  const insertedRow = inserted[0];
  if (!insertedRow) {
    throw new Error('Failed to insert default kimi_config row');
  }

  return mapRow(insertedRow);
}
