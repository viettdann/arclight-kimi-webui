import { describe, expect, it } from 'bun:test';
import { DEFAULT_KIMI_CONFIG } from '../../../src/services/kimi-config/defaults';
import { computeConfigStatus } from '../../../src/services/kimi-config/status';

describe('computeConfigStatus', () => {
  it('reports not ready when apiKey is empty', () => {
    const status = computeConfigStatus(DEFAULT_KIMI_CONFIG);
    expect(status.ready).toBe(false);
    expect(status.authMode).toBe('unconfigured');
    expect(status.missing).toContain('provider.apiKey');
  });

  it('reports ready when apiKey is set and model exists', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey: 'sk-test' },
    };
    const status = computeConfigStatus(row);
    expect(status.ready).toBe(true);
    expect(status.authMode).toBe('api_key');
    expect(status.missing).toHaveLength(0);
  });

  it('reports missing model when defaults.model not in models', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey: 'sk-test' },
      defaults: { ...DEFAULT_KIMI_CONFIG.defaults, model: 'nonexistent' },
    };
    const status = computeConfigStatus(row);
    expect(status.ready).toBe(false);
    expect(status.missing).toContain('defaults.model');
  });
});
