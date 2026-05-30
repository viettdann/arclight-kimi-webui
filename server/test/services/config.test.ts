import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// config.ts talks to the DB directly; mock the db module with an in-memory fake
// so the cache, env-fallback, secret-masking and upsert logic can be unit-tested
// without a real Postgres. `state` is mutated per test and reset in beforeEach.
// One file = one process (isolated runner), so the module mock never bleeds.
interface Row {
  key: string;
  value: string | null;
  isSecret: boolean;
  updatedAt?: Date;
}

const state: {
  findFirstResult: Row | undefined;
  findFirstCalls: number;
  rows: Row[];
  inserted: Array<{ key: string; value: string | null; isSecret: boolean }>;
  insertCalls: number;
} = { findFirstResult: undefined, findFirstCalls: 0, rows: [], inserted: [], insertCalls: 0 };

const fakeDb = {
  query: {
    appSettings: {
      findFirst: async () => {
        state.findFirstCalls += 1;
        return state.findFirstResult;
      },
    },
  },
  select: () => ({ from: async () => state.rows }),
  insert: () => ({
    values: (vals: any) => {
      // `updateSettings` awaits `.values({...}).onConflictDoUpdate(...)`. Record
      // at `.values()` time and hand back an awaitable that also exposes
      // `onConflictDoUpdate`. The array branch tolerates batch-insert callers.
      const arr = Array.isArray(vals) ? vals : [vals];
      state.insertCalls += 1;
      state.inserted.push(...arr);
      const result = Promise.resolve() as Promise<void> & {
        onConflictDoUpdate: () => Promise<void>;
      };
      result.onConflictDoUpdate = async () => {};
      return result;
    },
  }),
};

mock.module('../../src/db', () => ({ db: fakeDb }));

const { maskSecret, getConfig, clearConfigCache, getAllSettings, updateSettings, SEED_KEYS } =
  await import('../../src/services/config');

beforeEach(() => {
  state.findFirstResult = undefined;
  state.findFirstCalls = 0;
  state.rows = [];
  state.inserted = [];
  state.insertCalls = 0;
  clearConfigCache();
});

describe('maskSecret', () => {
  it('fully masks short values (<= 8 chars)', () => {
    expect(maskSecret('')).toBe('***');
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('abcdefgh')).toBe('***'); // exactly 8
  });

  it('shows a 7-char prefix + 4-char suffix for longer values', () => {
    expect(maskSecret('abcdefghi')).toBe('abcdefg***fghi'); // 9 chars
    expect(maskSecret('sk-ant-0123456789')).toBe('sk-ant-***6789');
  });
});

describe('getConfig — resolution order (DB > ENV > Default) + cache', () => {
  // ANTHROPIC_BASE_URL: a known key with no code default — exercises the DB/ENV
  // layers. CLAUDE_PROVIDER: a known key with default 'oauth' — exercises the
  // Default layer. Save/restore env so host values don't leak across tests.
  let savedBaseUrl: string | undefined;
  let savedProvider: string | undefined;

  beforeEach(() => {
    savedBaseUrl = process.env.ANTHROPIC_BASE_URL;
    savedProvider = process.env.CLAUDE_PROVIDER;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.CLAUDE_PROVIDER;
  });
  afterEach(() => {
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
    if (savedProvider === undefined) delete process.env.CLAUDE_PROVIDER;
    else process.env.CLAUDE_PROVIDER = savedProvider;
  });

  it('throws on an unknown key — code is the source of truth', async () => {
    await expect(getConfig('__NOT_A_REAL_KEY__')).rejects.toThrow(/unknown config key/);
  });

  it('falls back to process.env when no DB row exists', async () => {
    state.findFirstResult = undefined;
    process.env.ANTHROPIC_BASE_URL = 'from-env';
    expect(await getConfig('ANTHROPIC_BASE_URL')).toBe('from-env');
  });

  it('prefers a non-empty DB value over process.env', async () => {
    state.findFirstResult = { key: 'ANTHROPIC_BASE_URL', value: 'from-db', isSecret: false };
    process.env.ANTHROPIC_BASE_URL = 'from-env';
    expect(await getConfig('ANTHROPIC_BASE_URL')).toBe('from-db');
  });

  it('treats an empty-string DB value as unset and falls back to env', async () => {
    state.findFirstResult = { key: 'ANTHROPIC_BASE_URL', value: '', isSecret: false };
    process.env.ANTHROPIC_BASE_URL = 'from-env';
    expect(await getConfig('ANTHROPIC_BASE_URL')).toBe('from-env');
  });

  it('falls back to the code default when DB and env are both unset', async () => {
    state.findFirstResult = undefined; // CLAUDE_PROVIDER env cleared in beforeEach
    expect(await getConfig('CLAUDE_PROVIDER')).toBe('oauth');
  });

  it('returns undefined for a known key with no DB/env/default value', async () => {
    state.findFirstResult = undefined; // ANTHROPIC_BASE_URL has no default
    expect(await getConfig('ANTHROPIC_BASE_URL')).toBeUndefined();
  });

  it('caches within the TTL — a second read does not hit the DB', async () => {
    state.findFirstResult = { key: 'ANTHROPIC_BASE_URL', value: 'v', isSecret: false };
    expect(await getConfig('ANTHROPIC_BASE_URL')).toBe('v');
    expect(await getConfig('ANTHROPIC_BASE_URL')).toBe('v');
    expect(state.findFirstCalls).toBe(1);
  });

  it('re-queries after clearConfigCache', async () => {
    state.findFirstResult = { key: 'ANTHROPIC_BASE_URL', value: 'v', isSecret: false };
    await getConfig('ANTHROPIC_BASE_URL');
    clearConfigCache();
    await getConfig('ANTHROPIC_BASE_URL');
    expect(state.findFirstCalls).toBe(2);
  });
});

describe('getAllSettings — masking + isSet', () => {
  it('returns exactly one DTO per SEED_KEYS entry', async () => {
    const dtos = await getAllSettings();
    expect(dtos.map((d) => d.key).sort()).toEqual(SEED_KEYS.map((s) => s.key).sort());
  });

  it('masks a secret value and marks it set', async () => {
    state.rows = [
      {
        key: 'ANTHROPIC_AUTH_TOKEN',
        value: 'super-secret-token-value',
        isSecret: true,
        updatedAt: new Date(),
      },
    ];
    const dtos = await getAllSettings();
    const secret = dtos.find((d) => d.key === 'ANTHROPIC_AUTH_TOKEN')!;
    expect(secret.isSet).toBe(true);
    expect(secret.value).toBe(maskSecret('super-secret-token-value'));
    expect(secret.value).not.toContain('super-secret-token-value');
  });

  it('shows a non-secret value verbatim', async () => {
    state.rows = [{ key: 'CLAUDE_PROVIDER', value: 'api', isSecret: false }];
    const dtos = await getAllSettings();
    const provider = dtos.find((d) => d.key === 'CLAUDE_PROVIDER')!;
    expect(provider.value).toBe('api');
    expect(provider.isSet).toBe(true);
  });

  it('reports an unset key with empty value and isSet=false', async () => {
    state.rows = [];
    const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const dtos = await getAllSettings();
      const oauth = dtos.find((d) => d.key === 'CLAUDE_CODE_OAUTH_TOKEN')!;
      expect(oauth.value).toBe('');
      expect(oauth.isSet).toBe(false);
    } finally {
      if (saved !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = saved;
    }
  });
});

describe('updateSettings — upsert + guards', () => {
  it('ignores unknown keys', async () => {
    await updateSettings([{ key: 'NOT_A_REAL_KEY', value: 'x' }]);
    expect(state.insertCalls).toBe(0);
  });

  it('skips keys with a null value (leave unchanged)', async () => {
    await updateSettings([{ key: 'CLAUDE_PROVIDER', value: null }]);
    expect(state.insertCalls).toBe(0);
  });

  it('upserts known keys with the seed isSecret flag', async () => {
    await updateSettings([
      { key: 'CLAUDE_PROVIDER', value: 'api' },
      { key: 'ANTHROPIC_AUTH_TOKEN', value: 'tok' },
    ]);
    expect(state.insertCalls).toBe(2);
    const provider = state.inserted.find((r) => r.key === 'CLAUDE_PROVIDER')!;
    const token = state.inserted.find((r) => r.key === 'ANTHROPIC_AUTH_TOKEN')!;
    expect(provider).toMatchObject({ value: 'api', isSecret: false });
    expect(token).toMatchObject({ value: 'tok', isSecret: true });
  });

  it('clears the config cache after a change', async () => {
    state.findFirstResult = { key: 'CLAUDE_PROVIDER', value: 'oauth', isSecret: false };
    await getConfig('CLAUDE_PROVIDER'); // findFirstCalls = 1, now cached
    await updateSettings([{ key: 'CLAUDE_PROVIDER', value: 'api' }]);
    await getConfig('CLAUDE_PROVIDER'); // cache cleared → must re-query
    expect(state.findFirstCalls).toBe(2);
  });
});
