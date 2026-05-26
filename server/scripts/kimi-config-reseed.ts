#!/usr/bin/env bun
/**
 * Force-resync the kimi_config DB row from KIMI_SEED_* env vars.
 *
 * The normal seed path (`loadOrSeed`) only runs once when the DB has no row.
 * Once seeded, changes to .env are ignored. Use this script when you need
 * the DB row to track the .env again (e.g. after rotating the API key or
 * changing the base URL).
 *
 * Usage:
 *   bun server/scripts/kimi-config-reseed.ts            # print diff, no write
 *   bun server/scripts/kimi-config-reseed.ts --write    # apply update
 *   bun server/scripts/kimi-config-reseed.ts --write --rewrite-toml
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { DEFAULT_KIMI_CONFIG } from '../src/services/kimi-config/defaults';
import { loadOrSeed } from '../src/services/kimi-config/load-or-seed';
import { seedFromEnv } from '../src/services/kimi-config/seed-from-env';
import { writeConfigToml } from '../src/services/kimi-config/write-toml';

const argv = new Set(process.argv.slice(2));
const write = argv.has('--write');
const rewriteToml = argv.has('--rewrite-toml');

function mask(s: string | undefined): string {
  if (!s) return '(empty)';
  if (s.length <= 12) return `${s.slice(0, 4)}…(${s.length})`;
  return `${s.slice(0, 8)}…(${s.length})`;
}

const current = await loadOrSeed(db);
const seed = seedFromEnv();

const nextProvider = {
  ...current.provider,
  ...(seed.provider ?? {}),
};
const nextDefaults = {
  ...current.defaults,
  ...(seed.defaults ?? {}),
};
const nextModels = {
  ...current.models,
  ...(seed.models ?? {}),
};

console.log('=== current DB row ===');
console.log('provider.type    :', current.provider.type);
console.log('provider.baseUrl :', current.provider.baseUrl);
console.log('provider.apiKey  :', mask(current.provider.apiKey));
console.log('defaults.model   :', current.defaults.model);
const curModel = current.models[current.defaults.model];
console.log('model.api name   :', curModel?.model ?? '(missing)');

console.log('\n=== .env seed (resolved) ===');
console.log('provider.type    :', nextProvider.type);
console.log('provider.baseUrl :', nextProvider.baseUrl);
console.log('provider.apiKey  :', mask(nextProvider.apiKey));
console.log('defaults.model   :', nextDefaults.model);
const nextModel = nextModels[nextDefaults.model];
console.log('model.api name   :', nextModel?.model ?? '(missing)');

const changed =
  current.provider.baseUrl !== nextProvider.baseUrl ||
  current.provider.apiKey !== nextProvider.apiKey ||
  current.provider.type !== nextProvider.type ||
  current.defaults.model !== nextDefaults.model ||
  JSON.stringify(curModel) !== JSON.stringify(nextModel);

if (!changed) {
  console.log('\nNo differences. Nothing to do.');
  process.exit(0);
}

if (!write) {
  console.log('\nDry run. Pass --write to apply, --rewrite-toml to also re-render config.toml.');
  process.exit(0);
}

const merged = {
  ...current,
  defaults: nextDefaults,
  provider: nextProvider,
  models: nextModels,
  updatedAt: new Date().toISOString(),
};

await db
  .update(schema.kimiConfig)
  .set({
    defaults: merged.defaults,
    provider: merged.provider,
    models: merged.models,
    updatedAt: new Date(merged.updatedAt),
  })
  .where(eq(schema.kimiConfig.id, 1));

console.log('\nDB row updated.');

if (rewriteToml) {
  writeConfigToml(merged);
  console.log('config.toml re-rendered.');
}

// Drizzle/postgres-js keeps the connection pool open; force exit.
process.exit(0);
