import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../../../src/services/kimi-config/bootstrap';
import { DEFAULT_KIMI_CONFIG } from '../../../src/services/kimi-config/defaults';
import { makeFakeDb } from '../../_helpers';

const TMP_SHARE_DIR = path.join('/tmp', `kimi-bootstrap-test-${Date.now()}`);

describe('bootstrap', () => {
  beforeEach(() => {
    if (!existsSync(TMP_SHARE_DIR)) {
      mkdirSync(TMP_SHARE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      rmSync(TMP_SHARE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates share dir tree and writes config.toml', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // no existing config
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

    const { shareDir } = await bootstrap(fake.db, { shareDir: TMP_SHARE_DIR });
    expect(shareDir).toBe(TMP_SHARE_DIR);

    const tomlPath = path.join(TMP_SHARE_DIR, 'config.toml');
    expect(existsSync(tomlPath)).toBe(true);

    const content = readFileSync(tomlPath, 'utf8');
    expect(content).toContain('[providers.kimi]');
    expect(content).toContain('api_key = ""');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('is idempotent on re-run', async () => {
    const fake = makeFakeDb();
    const existingRow = {
      id: 1,
      defaults: DEFAULT_KIMI_CONFIG.defaults,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey: 'sk-existing' },
      models: DEFAULT_KIMI_CONFIG.models,
      services: DEFAULT_KIMI_CONFIG.services,
      loopControl: DEFAULT_KIMI_CONFIG.loopControl,
      background: DEFAULT_KIMI_CONFIG.background,
      notifications: DEFAULT_KIMI_CONFIG.notifications,
      mcpClient: DEFAULT_KIMI_CONFIG.mcpClient,
      hooks: DEFAULT_KIMI_CONFIG.hooks,
      extraTomlOverride: '',
      updatedAt: new Date(),
    };
    fake.selectQueue.push([existingRow]);

    const first = await bootstrap(fake.db, { shareDir: TMP_SHARE_DIR });
    const second = await bootstrap(fake.db, { shareDir: TMP_SHARE_DIR });
    expect(first.shareDir).toBe(second.shareDir);

    const tomlPath = path.join(TMP_SHARE_DIR, 'config.toml');
    const content = readFileSync(tomlPath, 'utf8');
    expect(content).toContain('[providers.kimi]');
  });
});
