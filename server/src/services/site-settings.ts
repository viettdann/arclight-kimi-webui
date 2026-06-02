import { inArray, sql } from 'drizzle-orm';
import { DEFAULT_PROJECT_DISCOVERY_BLACKLIST } from 'shared/types';
import { type DB, schema } from '../db';

/**
 * Keys used in the `site_settings` table. Namespaced by feature so future
 * settings stay grouped. Each key maps to one row; absent rows fall back to the
 * code defaults at the read site (nothing is seeded).
 */
export const SITE_SETTING_KEYS = {
  /** string[] — extra directory names to exclude from project discovery. */
  projectDiscoveryEntries: 'project_discovery.entries',
  /** boolean — true replaces the built-in blacklist, false appends to it. */
  projectDiscoveryOverride: 'project_discovery.override',
} as const;

/** Read the raw jsonb values for a set of keys in a single round trip. */
async function readValues(db: DB, keys: string[]): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
    .from(schema.siteSettings)
    .where(inArray(schema.siteSettings.key, keys));
  return new Map(rows.map((r) => [r.key, r.value]));
}

/** Resolved project discovery configuration. */
export interface ProjectDiscoveryConfig {
  entries: string[];
  override: boolean;
}

/**
 * Read the site-wide project discovery config. Missing rows fall back to code
 * defaults: `{ entries: [], override: false }`, which yields the built-in
 * blacklist via {@link effectiveBlacklist}.
 */
export async function getProjectDiscoveryConfig(db: DB): Promise<ProjectDiscoveryConfig> {
  const values = await readValues(db, [
    SITE_SETTING_KEYS.projectDiscoveryEntries,
    SITE_SETTING_KEYS.projectDiscoveryOverride,
  ]);

  const rawEntries = values.get(SITE_SETTING_KEYS.projectDiscoveryEntries);
  const entries = Array.isArray(rawEntries)
    ? rawEntries.filter((e): e is string => typeof e === 'string')
    : [];
  const override = values.get(SITE_SETTING_KEYS.projectDiscoveryOverride) === true;

  return { entries, override };
}

/**
 * Upsert the site-wide project discovery config as two rows (`entries`,
 * `override`) in a single batched statement.
 */
export async function setProjectDiscoveryConfig(
  db: DB,
  config: ProjectDiscoveryConfig,
): Promise<void> {
  await db
    .insert(schema.siteSettings)
    .values([
      { key: SITE_SETTING_KEYS.projectDiscoveryEntries, value: config.entries },
      { key: SITE_SETTING_KEYS.projectDiscoveryOverride, value: config.override },
    ])
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    });
}

/**
 * Compute the effective blacklist set from a config. `override` uses only the
 * custom entries; otherwise they merge with the built-in defaults.
 */
export function effectiveBlacklist(config: ProjectDiscoveryConfig): Set<string> {
  if (config.override) return new Set(config.entries);
  return new Set([...DEFAULT_PROJECT_DISCOVERY_BLACKLIST, ...config.entries]);
}
