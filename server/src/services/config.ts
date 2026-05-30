import { eq } from 'drizzle-orm';
import type { ConfigSettingDTO } from 'shared/types/config';
import { db } from '../db';
import { appSettings } from '../db/schema';
import { logger } from '../lib/logger';

/** Seed definition for a single app_settings key. */
interface SeedKey {
  key: string;
  isSecret: boolean;
  default?: string;
}

/** Source of truth for expected app_settings keys. */
const SEED_KEYS: SeedKey[] = [
  { key: 'CLAUDE_PROVIDER', isSecret: false, default: 'oauth' },
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', isSecret: true },
  { key: 'ANTHROPIC_BASE_URL', isSecret: false },
  { key: 'ANTHROPIC_AUTH_TOKEN', isSecret: true },
  { key: 'ANTHROPIC_MODEL', isSecret: false },
  { key: 'DEFAULT_MODEL', isSecret: false, default: 'claude-sonnet-4-6' },
  { key: 'WORKSPACE_ROOT', isSecret: false },
];

const SEED_BY_KEY = new Map<string, SeedKey>(SEED_KEYS.map((s) => [s.key, s]));

// ─────────────────────────── Cache ───────────────────────────

interface CacheEntry {
  value: string | undefined;
  expiry: number;
}

/** In-memory cache for getConfig — avoids a DB round-trip on every read. */
const configCache = new Map<string, CacheEntry>();
const CONFIG_CACHE_TTL = 60_000; // 60 seconds

/** Empty the config cache. Call after any settings mutation. */
export function clearConfigCache(): void {
  configCache.clear();
}

// ─────────────────────────── Reads ───────────────────────────

/**
 * Resolve a config value: cache → DB row (non-null, non-empty) → process.env.
 * Result is cached with a short TTL.
 */
export async function getConfig(key: string): Promise<string | undefined> {
  const cached = configCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;

  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, key),
  });
  const dbValue = row?.value;
  const value = dbValue != null && dbValue !== '' ? dbValue : process.env[key];

  configCache.set(key, { value, expiry: Date.now() + CONFIG_CACHE_TTL });
  return value;
}

// ─────────────────────────── Seed / startup ───────────────────────────

/**
 * Insert SEED_KEYS that have no row yet; existing keys are left untouched.
 * Initial value = process.env[key] ?? default ?? null. Idempotent.
 */
export async function seedAppSettings(): Promise<void> {
  const existing = await db.select({ key: appSettings.key }).from(appSettings);
  const existingKeys = new Set(existing.map((r) => r.key));

  const toInsert = SEED_KEYS.filter((s) => !existingKeys.has(s.key));
  if (toInsert.length === 0) {
    logger.debug('app_settings: all keys present, nothing to seed');
    return;
  }

  await db.insert(appSettings).values(
    toInsert.map((s) => ({
      key: s.key,
      value: process.env[s.key] ?? s.default ?? null,
      isSecret: s.isSecret,
    })),
  );

  logger.info(
    { keys: toInsert.map((s) => s.key) },
    `app_settings: seeded ${toInsert.length} new key(s)`,
  );
}

/** Seed settings then clear the cache so first reads are fresh. Runs once at startup. */
export async function loadStartupConfig(): Promise<void> {
  await seedAppSettings();
  clearConfigCache();
}

// ─────────────────────────── Masked GET / PATCH ───────────────────────────

/** Mask a secret value for display. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 7)}***${value.slice(-4)}`;
}

/**
 * One DTO per SEED_KEYS key. Secrets are masked; unset keys yield ''.
 * `isSet` reflects whether a non-empty effective value exists (DB value or env).
 */
export async function getAllSettings(): Promise<ConfigSettingDTO[]> {
  const rows = await db.select().from(appSettings);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  return SEED_KEYS.map((seed) => {
    const row = rowByKey.get(seed.key);
    const dbValue = row?.value;
    const hasDbValue = dbValue != null && dbValue !== '';
    const envValue = process.env[seed.key];

    const effective = hasDbValue ? dbValue : (envValue ?? '');
    const isSet = effective !== '';

    let value = '';
    if (isSet) {
      value = seed.isSecret ? maskSecret(effective) : effective;
    }

    return {
      key: seed.key,
      value,
      isSecret: seed.isSecret,
      isSet,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}

/**
 * Upsert the given settings. Only known SEED_KEYS keys are honored; unknown
 * keys are ignored. value === null leaves the key unchanged (keep existing
 * secret). The cache is cleared after any change.
 */
export async function updateSettings(
  items: { key: string; value: string | null }[],
): Promise<void> {
  let changed = false;

  for (const item of items) {
    const seed = SEED_BY_KEY.get(item.key);
    if (!seed) continue; // unknown key
    if (item.value === null) continue; // leave unchanged

    await db
      .insert(appSettings)
      .values({
        key: item.key,
        value: item.value,
        isSecret: seed.isSecret,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: item.value,
          isSecret: seed.isSecret,
          updatedAt: new Date(),
        },
      });

    changed = true;
  }

  if (changed) clearConfigCache();
}

export { SEED_KEYS };
