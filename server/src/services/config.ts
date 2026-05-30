import { eq } from 'drizzle-orm';
import type { ConfigSettingDTO } from 'shared/types/config';
import { db } from '../db';
import { appSettings } from '../db/schema';

/** Definition for a single known config key. */
interface SeedKey {
  key: string;
  isSecret: boolean;
  /** Code-level default — the lowest layer of the DB > ENV > Default chain. */
  default?: string;
}

/**
 * Code is the source of truth for which config keys exist and their defaults.
 * The DB and process.env are read-only value sources at runtime; this app never
 * writes defaults back into either. Resolution order is DB > ENV > Default.
 */
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

/** First value that is neither null/undefined nor an empty string. */
function firstNonEmpty(...vals: (string | null | undefined)[]): string | undefined {
  for (const v of vals) {
    if (v != null && v !== '') return v;
  }
  return undefined;
}

/**
 * Resolve a config value with the chain DB > ENV > Default (empty strings are
 * treated as unset at each layer). Result is cached with a short TTL.
 *
 * Code is the source of truth: an unknown key — one not declared in SEED_KEYS —
 * is a programming error and throws. A known key with no value anywhere returns
 * undefined; the caller decides whether that is acceptable.
 */
export async function getConfig(key: string): Promise<string | undefined> {
  const seed = SEED_BY_KEY.get(key);
  if (!seed) {
    throw new Error(`getConfig: unknown config key "${key}" — not declared in SEED_KEYS`);
  }

  const cached = configCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;

  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, key),
  });
  const value = firstNonEmpty(row?.value, process.env[key], seed.default);

  configCache.set(key, { value, expiry: Date.now() + CONFIG_CACHE_TTL });
  return value;
}

// ─────────────────────────── Masked GET / PATCH ───────────────────────────

/** Mask a secret value for display. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 7)}***${value.slice(-4)}`;
}

/**
 * One DTO per SEED_KEYS key. Secrets are masked; unset keys yield ''.
 * `isSet` reflects whether a non-empty effective value exists under the
 * DB > ENV > Default chain.
 */
export async function getAllSettings(): Promise<ConfigSettingDTO[]> {
  const rows = await db.select().from(appSettings);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  return SEED_KEYS.map((seed) => {
    const row = rowByKey.get(seed.key);
    // Same DB > ENV > Default chain as getConfig.
    const effective = firstNonEmpty(row?.value, process.env[seed.key], seed.default) ?? '';
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
