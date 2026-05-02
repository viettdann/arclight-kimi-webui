import { describe, expect, it } from 'bun:test';
import { DEFAULT_KIMI_CONFIG } from '../../../src/services/kimi-config/defaults';
import { loadOrSeed } from '../../../src/services/kimi-config/load-or-seed';
import { makeFakeDb } from '../../_helpers';

describe('loadOrSeed', () => {
  it('returns existing row when DB has a config', async () => {
    const fake = makeFakeDb();
    const existingRow = {
      id: 1,
      defaults: DEFAULT_KIMI_CONFIG.defaults,
      provider: DEFAULT_KIMI_CONFIG.provider,
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

    const row = await loadOrSeed(fake.db);
    expect(row.id).toBe(1);
    expect(row.provider.type).toBe('kimi');
    expect(row.defaults.model).toBe('kimi-code/kimi-for-coding');

    const selectCall = fake.calls.find((c) => c.op === 'select');
    expect(selectCall).toBeDefined();
  });

  it('inserts default row when DB is empty', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    fake.selectQueue.push([
      {
        id: 1,
        defaults: DEFAULT_KIMI_CONFIG.defaults,
        provider: DEFAULT_KIMI_CONFIG.provider,
        models: DEFAULT_KIMI_CONFIG.models,
        services: DEFAULT_KIMI_CONFIG.services,
        loopControl: DEFAULT_KIMI_CONFIG.loopControl,
        background: DEFAULT_KIMI_CONFIG.background,
        notifications: DEFAULT_KIMI_CONFIG.notifications,
        mcpClient: DEFAULT_KIMI_CONFIG.mcpClient,
        hooks: DEFAULT_KIMI_CONFIG.hooks,
        extraTomlOverride: '',
        updatedAt: new Date(),
      },
    ]);

    const row = await loadOrSeed(fake.db);
    expect(row.id).toBe(1);
    expect(row.provider.type).toBe('kimi');

    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
  });
});
