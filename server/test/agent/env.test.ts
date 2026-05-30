import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { env } from '../../src/env';

// `buildAgentEnv` resolves the provider + auth vars through `getConfig`. Mock it
// so the test drives the provider switch without a DB; each test mutates `cfg`.
// One file = one process (isolated runner), so this module mock never bleeds.
const cfg: Record<string, string | undefined> = {};
mock.module('../../src/services/config', () => ({
  getConfig: async (key: string) => cfg[key],
}));

const { buildAgentEnv, pickSafeEnv, SAFE_ENV_KEYS } = await import('../../src/services/agent/env');

function resetCfg(): void {
  for (const k of Object.keys(cfg)) delete cfg[k];
}

describe('pickSafeEnv', () => {
  it('copies only whitelisted keys present in the source', () => {
    const src = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      NOT_SAFE: 'leak',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    };
    expect(pickSafeEnv(SAFE_ENV_KEYS, src)).toEqual({ PATH: '/usr/bin', HOME: '/home/x' });
  });

  it('drops keys with empty/undefined values', () => {
    const src = { PATH: '/usr/bin', HOME: '', TERM: undefined };
    expect(pickSafeEnv(SAFE_ENV_KEYS, src)).toEqual({ PATH: '/usr/bin' });
  });

  it('honors a custom key list', () => {
    const src = { PATH: '/usr/bin', HOME: '/home/x' };
    expect(pickSafeEnv(['HOME'], src)).toEqual({ HOME: '/home/x' });
  });

  it('returns an empty object when nothing matches', () => {
    expect(pickSafeEnv(SAFE_ENV_KEYS, { FOO: 'bar' })).toEqual({});
  });
});

describe('buildAgentEnv — provider switch', () => {
  beforeEach(resetCfg);

  it('oauth: injects only the OAuth token + config dir, never Anthropic vars', async () => {
    cfg.CLAUDE_PROVIDER = 'oauth';
    cfg.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-tok';
    cfg.ANTHROPIC_BASE_URL = 'https://should-not-leak';
    const result = await buildAgentEnv();
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-tok');
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
    expect('ANTHROPIC_BASE_URL' in result).toBe(false);
    expect('ANTHROPIC_AUTH_TOKEN' in result).toBe(false);
    expect('ANTHROPIC_MODEL' in result).toBe(false);
  });

  it('defaults to the oauth branch when the provider is unset', async () => {
    cfg.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-tok';
    const result = await buildAgentEnv();
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-tok');
    expect('ANTHROPIC_AUTH_TOKEN' in result).toBe(false);
  });

  it('api: injects the three Anthropic vars, never the OAuth token', async () => {
    cfg.CLAUDE_PROVIDER = 'api';
    cfg.ANTHROPIC_BASE_URL = 'https://api.example';
    cfg.ANTHROPIC_AUTH_TOKEN = 'api-tok';
    cfg.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
    cfg.CLAUDE_CODE_OAUTH_TOKEN = 'should-not-leak';
    const result = await buildAgentEnv();
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.example');
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('api-tok');
    expect(result.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
    expect('CLAUDE_CODE_OAUTH_TOKEN' in result).toBe(false);
  });
});

describe('buildAgentEnv — empty-value stripping', () => {
  beforeEach(resetCfg);

  it('strips an empty OAuth token but keeps the config dir', async () => {
    cfg.CLAUDE_PROVIDER = 'oauth';
    cfg.CLAUDE_CODE_OAUTH_TOKEN = '';
    const result = await buildAgentEnv();
    expect('CLAUDE_CODE_OAUTH_TOKEN' in result).toBe(false);
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
  });

  it('strips an unset Anthropic var (api) while keeping the set ones', async () => {
    cfg.CLAUDE_PROVIDER = 'api';
    cfg.ANTHROPIC_BASE_URL = 'https://api.example';
    cfg.ANTHROPIC_AUTH_TOKEN = 'api-tok';
    cfg.ANTHROPIC_MODEL = undefined;
    const result = await buildAgentEnv();
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.example');
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('api-tok');
    expect('ANTHROPIC_MODEL' in result).toBe(false);
  });
});

describe('buildAgentEnv — env whitelist boundary', () => {
  beforeEach(resetCfg);

  it('always carries CLAUDE_CONFIG_DIR', async () => {
    cfg.CLAUDE_PROVIDER = 'oauth';
    const result = await buildAgentEnv();
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
  });

  it('never forwards a non-whitelisted process.env key', async () => {
    cfg.CLAUDE_PROVIDER = 'oauth';
    process.env.__AGENT_ENV_LEAK__ = 'secret';
    try {
      const result = await buildAgentEnv();
      expect('__AGENT_ENV_LEAK__' in result).toBe(false);
    } finally {
      delete process.env.__AGENT_ENV_LEAK__;
    }
  });
});
