import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { makeFakeDb } from '../../_helpers';

// Stubs the env module so tests can toggle KIMI_* values between cases.
// `getKimiConfig` reads `env.KIMI_*` lazily inside `buildPartialFromEnv`, so
// mutating this object between tests works without re-importing.
const envStub: Record<string, string | undefined> = {};

mock.module('../../../src/env', () => ({
  env: envStub,
}));

const { getKimiConfig } = await import('../../../src/services/kimi-config/get-kimi-config');
const { DEFAULT_KIMI_CONFIG } = await import('../../../src/services/kimi-config/defaults');

beforeEach(() => {
  for (const key of Object.keys(envStub)) {
    delete envStub[key];
  }
});

describe('getKimiConfig', () => {
  it('DB has row → returns mapped row, no writes', async () => {
    const fake = makeFakeDb();
    const existingRow = {
      id: 1,
      defaults: { ...DEFAULT_KIMI_CONFIG.defaults, model: 'custom/model' },
      provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey: 'sk-from-db' },
      models: DEFAULT_KIMI_CONFIG.models,
      services: DEFAULT_KIMI_CONFIG.services,
      loopControl: DEFAULT_KIMI_CONFIG.loopControl,
      background: DEFAULT_KIMI_CONFIG.background,
      notifications: DEFAULT_KIMI_CONFIG.notifications,
      mcpClient: DEFAULT_KIMI_CONFIG.mcpClient,
      hooks: DEFAULT_KIMI_CONFIG.hooks,
      extraTomlOverride: '',
      updatedAt: new Date('2024-01-01'),
    };
    fake.selectQueue.push([existingRow]);

    // Env values must be ignored when DB row is present.
    envStub.KIMI_API_KEY = 'sk-env-should-be-ignored';
    envStub.KIMI_BASE_URL = 'https://env.example.com';

    const row = await getKimiConfig(fake.db);
    expect(row.id).toBe(1);
    expect(row.provider.apiKey).toBe('sk-from-db');
    expect(row.defaults.model).toBe('custom/model');

    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(fake.calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('DB empty, env present → folds env values into merged row, no insert', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);

    envStub.KIMI_API_KEY = 'sk-from-env';
    envStub.KIMI_BASE_URL = 'https://env.example.com';
    envStub.KIMI_PROVIDER_TYPE = 'kimi';
    envStub.KIMI_DEFAULT_MODEL = 'kimi-code/from-env';
    envStub.KIMI_MODEL_PROVIDER = 'managed:env';
    envStub.KIMI_MODEL_NAME = 'env-model-name';
    envStub.KIMI_MODEL_MAX_CONTEXT_SIZE = '131072';
    envStub.KIMI_MODEL_CAPABILITIES = 'thinking,image_in';
    envStub.KIMI_MODEL_DISPLAY_NAME = 'EnvModel';

    const row = await getKimiConfig(fake.db);

    expect(row.provider.apiKey).toBe('sk-from-env');
    expect(row.provider.baseUrl).toBe('https://env.example.com');
    expect(row.provider.type).toBe('kimi');
    expect(row.defaults.model).toBe('kimi-code/from-env');
    const modelEntry = row.models['kimi-code/from-env'];
    expect(modelEntry).toBeDefined();
    expect(modelEntry?.provider).toBe('managed:env');
    expect(modelEntry?.model).toBe('env-model-name');
    expect(modelEntry?.maxContextSize).toBe(131_072);
    expect(modelEntry?.capabilities).toEqual(['thinking', 'image_in']);
    expect(modelEntry?.displayName).toBe('EnvModel');

    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(fake.calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('DB empty, env absent → returns DEFAULT_KIMI_CONFIG, no insert', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);

    const row = await getKimiConfig(fake.db);

    expect(row.provider).toEqual(DEFAULT_KIMI_CONFIG.provider);
    expect(row.defaults).toEqual(DEFAULT_KIMI_CONFIG.defaults);
    expect(row.models).toEqual(DEFAULT_KIMI_CONFIG.models);
    expect(row.services).toEqual(DEFAULT_KIMI_CONFIG.services);
    expect(row.loopControl).toEqual(DEFAULT_KIMI_CONFIG.loopControl);
    expect(row.provider.apiKey).toBe('');

    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(fake.calls.find((c) => c.op === 'update')).toBeUndefined();
  });
});
