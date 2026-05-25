import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(content).toContain('[providers."managed:kimi-code"]');
    expect(content).toContain('api_key = ""');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('writeTomlMode=if-missing preserves a pre-existing file', async () => {
    const fake = makeFakeDb();
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

    const tomlPath = path.join(TMP_SHARE_DIR, 'config.toml');
    const original = '# user-edited sentinel\n';
    writeFileSync(tomlPath, original);

    const result = await bootstrap(fake.db, {
      shareDir: TMP_SHARE_DIR,
      writeTomlMode: 'if-missing',
    });

    expect(result.tomlWritten).toBe(false);
    expect(readFileSync(tomlPath, 'utf8')).toBe(original);
  });

  it('writeTomlMode=never skips writing even when file is missing', async () => {
    const fake = makeFakeDb();
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

    const result = await bootstrap(fake.db, {
      shareDir: TMP_SHARE_DIR,
      writeTomlMode: 'never',
    });

    expect(result.tomlWritten).toBe(false);
    expect(existsSync(path.join(TMP_SHARE_DIR, 'config.toml'))).toBe(false);
  });

  it('writeTomlMode=always overwrites a pre-existing file', async () => {
    const fake = makeFakeDb();
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

    const tomlPath = path.join(TMP_SHARE_DIR, 'config.toml');
    writeFileSync(tomlPath, '# stale\n');

    const result = await bootstrap(fake.db, {
      shareDir: TMP_SHARE_DIR,
      writeTomlMode: 'always',
    });

    expect(result.tomlWritten).toBe(true);
    expect(readFileSync(tomlPath, 'utf8')).toContain('[providers."managed:kimi-code"]');
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
    expect(content).toContain('[providers."managed:kimi-code"]');
  });
});
