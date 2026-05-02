import { describe, expect, it } from 'bun:test';
import { DEFAULT_KIMI_CONFIG } from '../../../src/services/kimi-config/defaults';
import { buildEnvFromRow } from '../../../src/services/kimi-config/env';

describe('buildEnvFromRow', () => {
  it('builds KIMI_* env for kimi provider', () => {
    const env = buildEnvFromRow(DEFAULT_KIMI_CONFIG);
    expect(env.KIMI_API_KEY).toBe('');
    expect(env.KIMI_BASE_URL).toBe('https://api.kimi.com/coding/v1');
    expect(env.KIMI_MODEL_NAME).toBe('kimi-for-coding');
    expect(env.KIMI_MODEL_MAX_CONTEXT_SIZE).toBe('262144');
    expect(env.KIMI_MODEL_CAPABILITIES).toBe('thinking,image_in,video_in');
    expect(env.KIMI_CLI_NO_AUTO_UPDATE).toBe('1');
  });

  it('builds OPENAI_* env for openai_legacy provider', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: {
        ...DEFAULT_KIMI_CONFIG.provider,
        type: 'openai_legacy' as const,
        apiKey: 'sk-openai',
      },
    };
    const env = buildEnvFromRow(row);
    expect(env.OPENAI_API_KEY).toBe('sk-openai');
    expect(env.OPENAI_BASE_URL).toBe('https://api.kimi.com/coding/v1');
    expect(env.KIMI_API_KEY).toBeUndefined();
  });

  it('builds OPENAI_* env for openai_responses provider', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: {
        ...DEFAULT_KIMI_CONFIG.provider,
        type: 'openai_responses' as const,
        apiKey: 'sk-openai',
      },
    };
    const env = buildEnvFromRow(row);
    expect(env.OPENAI_API_KEY).toBe('sk-openai');
  });

  it('omits secret env for anthropic provider', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, type: 'anthropic' as const, apiKey: 'sk-ant' },
    };
    const env = buildEnvFromRow(row);
    expect(env.KIMI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.KIMI_CLI_NO_AUTO_UPDATE).toBe('1');
  });

  it('omits secret env for gemini provider', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, type: 'gemini' as const, apiKey: 'sk-gem' },
    };
    const env = buildEnvFromRow(row);
    expect(env.KIMI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('omits secret env for vertexai provider', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, type: 'vertexai' as const, apiKey: 'sk-vtx' },
    };
    const env = buildEnvFromRow(row);
    expect(env.KIMI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('merges provider.env last-write-wins', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: {
        ...DEFAULT_KIMI_CONFIG.provider,
        env: { KIMI_API_KEY: 'override', CUSTOM_VAR: 'hello' },
      },
    };
    const env = buildEnvFromRow(row);
    expect(env.KIMI_API_KEY).toBe('override');
    expect(env.CUSTOM_VAR).toBe('hello');
  });

  it('skips model env when defaults.model not in models', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      defaults: { ...DEFAULT_KIMI_CONFIG.defaults, model: 'nonexistent' },
    };
    const env = buildEnvFromRow(row);
    expect(env.KIMI_MODEL_NAME).toBeUndefined();
    expect(env.KIMI_MODEL_MAX_CONTEXT_SIZE).toBeUndefined();
  });
});
