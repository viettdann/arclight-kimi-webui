import { inArray, sql } from 'drizzle-orm';
import { DEFAULT_PROJECT_DISCOVERY_BLACKLIST } from 'shared/types';
import { type DB, schema } from '../db';
import { env } from '../env';

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
  /** boolean — whether access control is enabled. */
  accessEnabled: 'access.enabled',
  /** string — session default approval mode. Code default: 'ask'. */
  sessionApprovalMode: 'session_defaults.approval_mode',
  /** boolean — session default thinking. Code default: true. */
  sessionThinking: 'session_defaults.thinking',
} as const;

/** Read the raw jsonb values for a set of keys in a single round trip. */
async function readValues(db: DB, keys: string[]): Promise<Map<string, unknown>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
    .from(schema.siteSettings)
    .where(inArray(schema.siteSettings.key, keys));
  return new Map(rows.map((r) => [r.key, r.value]));
}

/** Read ALL rows from site_settings. */
export async function readAll(db: DB): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
    .from(schema.siteSettings);
  return new Map(rows.map((r) => [r.key, r.value]));
}

/**
 * Batch upsert site settings. Entries with `value === null` are deleted.
 * Others are inserted or updated via onConflictDoUpdate.
 */
export async function batchUpsert(
  db: DB,
  entries: { key: string; value: unknown }[],
): Promise<void> {
  const toDelete = entries.filter((e) => e.value === null);
  const toUpsert = entries.filter((e) => e.value !== null);

  await Promise.all([
    toDelete.length > 0
      ? db.delete(schema.siteSettings).where(
          inArray(
            schema.siteSettings.key,
            toDelete.map((e) => e.key),
          ),
        )
      : Promise.resolve(),
    toUpsert.length > 0
      ? db
          .insert(schema.siteSettings)
          .values(
            toUpsert.map((e) => ({
              key: e.key,
              value: e.value,
            })),
          )
          .onConflictDoUpdate({
            target: schema.siteSettings.key,
            set: { value: sql`excluded.value`, updatedAt: sql`now()` },
          })
      : Promise.resolve(),
  ]);
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
  await batchUpsert(db, [
    { key: SITE_SETTING_KEYS.projectDiscoveryEntries, value: config.entries },
    { key: SITE_SETTING_KEYS.projectDiscoveryOverride, value: config.override },
  ]);
}

/**
 * Compute the effective blacklist set from a config. `override` uses only the
 * custom entries; otherwise they merge with the built-in defaults.
 */
export function effectiveBlacklist(config: ProjectDiscoveryConfig): Set<string> {
  if (config.override) return new Set(config.entries);
  return new Set([...DEFAULT_PROJECT_DISCOVERY_BLACKLIST, ...config.entries]);
}

/**
 * Read access control state from site_settings.
 * Code default: `env.ACCESS_CONTROL_ENABLED === 'true'`.
 */
export async function resolveAccessControlFromSettings(db: DB): Promise<{
  override: boolean | null;
  envDefault: boolean;
  effective: boolean;
}> {
  const values = await readValues(db, [SITE_SETTING_KEYS.accessEnabled]);
  const raw = values.get(SITE_SETTING_KEYS.accessEnabled);
  const envDefault = env.ACCESS_CONTROL_ENABLED === 'true';
  const override = typeof raw === 'boolean' ? raw : null;
  return { override, envDefault, effective: override ?? envDefault };
}

/**
 * Get session defaults from site settings.
 * Code defaults: approvalMode = 'ask', thinking = true.
 */
export async function getSessionDefaults(db: DB): Promise<{
  approvalMode: string;
  thinking: boolean;
}> {
  const values = await readValues(db, [
    SITE_SETTING_KEYS.sessionApprovalMode,
    SITE_SETTING_KEYS.sessionThinking,
  ]);

  const approvalMode =
    typeof values.get(SITE_SETTING_KEYS.sessionApprovalMode) === 'string'
      ? (values.get(SITE_SETTING_KEYS.sessionApprovalMode) as string)
      : 'ask';

  const thinking =
    typeof values.get(SITE_SETTING_KEYS.sessionThinking) === 'boolean'
      ? (values.get(SITE_SETTING_KEYS.sessionThinking) as boolean)
      : true;

  return { approvalMode, thinking };
}
