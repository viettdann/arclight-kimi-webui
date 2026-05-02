import type { KimiConfigRow, ProviderType } from 'shared/types/kimi-config';
import { env } from '../../env';

const VALID_PROVIDER_TYPES: ProviderType[] = [
  'kimi',
  'openai_legacy',
  'openai_responses',
  'anthropic',
  'gemini',
  'vertexai',
];

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

  const defaultModel = env.KIMI_SEED_DEFAULT_MODEL;
  if (defaultModel !== undefined) {
    seed.defaults = {
      ...(seed.defaults ?? {}),
      model: defaultModel,
    } as KimiConfigRow['defaults'];

    const modelEntry: KimiConfigRow['models'][string] = {
      provider: env.KIMI_SEED_MODEL_PROVIDER ?? '',
      model: env.KIMI_SEED_MODEL_NAME ?? '',
      maxContextSize: env.KIMI_SEED_MODEL_MAX_CONTEXT_SIZE
        ? parseInt(env.KIMI_SEED_MODEL_MAX_CONTEXT_SIZE, 10)
        : 0,
      capabilities: env.KIMI_SEED_MODEL_CAPABILITIES
        ? (env.KIMI_SEED_MODEL_CAPABILITIES.split(
            ',',
          ) as KimiConfigRow['models'][string]['capabilities'])
        : [],
    };

    if (env.KIMI_SEED_MODEL_DISPLAY_NAME !== undefined) {
      modelEntry.displayName = env.KIMI_SEED_MODEL_DISPLAY_NAME;
    }

    seed.models = {
      ...(seed.models ?? {}),
      [defaultModel]: modelEntry,
    };
  }

  return seed;
}
