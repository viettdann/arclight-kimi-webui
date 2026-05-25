import type { KimiConfigRow, ProviderType } from 'shared/types/kimi-config';
import { env } from '../../env';
import { DEFAULT_KIMI_CONFIG } from './defaults';

const VALID_PROVIDER_TYPES: ProviderType[] = [
  'kimi',
  'openai_legacy',
  'openai_responses',
  'anthropic',
  'gemini',
  'vertexai',
];

// Seed values pulled from env into the row that gets inserted on first boot.
// Only consumed by `loadOrSeed` when the DB has no row yet — after that the DB
// row is the source of truth and these env vars are ignored.
//
// KIMI_SEED_DEFAULT_MODEL triggers building a model entry. The remaining
// KIMI_SEED_MODEL_* keys are used to populate that entry — anything missing
// falls back to the matching value in DEFAULT_KIMI_CONFIG so a partial env
// (e.g. only PROVIDER_API_KEY) still yields a usable model row.
export function seedFromEnv(): Partial<KimiConfigRow> {
  const seed: Partial<KimiConfigRow> = {};

  if (env.KIMI_SEED_PROVIDER_TYPE !== undefined) {
    const type = VALID_PROVIDER_TYPES.includes(env.KIMI_SEED_PROVIDER_TYPE as ProviderType)
      ? (env.KIMI_SEED_PROVIDER_TYPE as ProviderType)
      : undefined;
    if (type !== undefined) {
      seed.provider = {
        ...(seed.provider ?? {}),
        type,
      } as KimiConfigRow['provider'];
    }
  }

  if (env.KIMI_SEED_PROVIDER_BASE_URL !== undefined) {
    seed.provider = {
      ...(seed.provider ?? {}),
      baseUrl: env.KIMI_SEED_PROVIDER_BASE_URL,
    } as KimiConfigRow['provider'];
  }

  if (env.KIMI_SEED_PROVIDER_API_KEY !== undefined) {
    seed.provider = {
      ...(seed.provider ?? {}),
      apiKey: env.KIMI_SEED_PROVIDER_API_KEY,
    } as KimiConfigRow['provider'];
  }

  const defaultModelKey = env.KIMI_SEED_DEFAULT_MODEL;
  if (defaultModelKey !== undefined) {
    const defaultEntry = DEFAULT_KIMI_CONFIG.models[DEFAULT_KIMI_CONFIG.defaults.model];

    seed.defaults = {
      ...(seed.defaults ?? {}),
      model: defaultModelKey,
    } as KimiConfigRow['defaults'];

    const modelEntry: KimiConfigRow['models'][string] = {
      provider: env.KIMI_SEED_MODEL_PROVIDER ?? defaultEntry?.provider ?? '',
      model: env.KIMI_SEED_MODEL_NAME ?? defaultEntry?.model ?? '',
      maxContextSize: env.KIMI_SEED_MODEL_MAX_CONTEXT_SIZE
        ? parseInt(env.KIMI_SEED_MODEL_MAX_CONTEXT_SIZE, 10)
        : (defaultEntry?.maxContextSize ?? 0),
      capabilities: env.KIMI_SEED_MODEL_CAPABILITIES
        ? (env.KIMI_SEED_MODEL_CAPABILITIES.split(
            ',',
          ) as KimiConfigRow['models'][string]['capabilities'])
        : (defaultEntry?.capabilities ?? []),
    };

    const displayName = env.KIMI_SEED_MODEL_DISPLAY_NAME ?? defaultEntry?.displayName;
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
