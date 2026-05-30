import { describe, expect, it } from 'bun:test';
import { env } from '../../src/env';
import { buildAgentEnv, pickSafeEnv, SAFE_ENV_KEYS } from '../../src/services/agent/env';

// `buildAgentEnv` is now a pure, synchronous mapping from a resolved provider
// row to the subprocess env. No DB/getConfig involved — provider resolution
// happens upstream (resolve.ts) and the row is passed in.

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

describe('buildAgentEnv — provider env shape', () => {
  it('oauth: injects only the OAuth token + config dir, never Anthropic vars', () => {
    const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'oauth-tok' });
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-tok');
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
    expect('ANTHROPIC_BASE_URL' in result).toBe(false);
    expect('ANTHROPIC_AUTH_TOKEN' in result).toBe(false);
    expect('ANTHROPIC_MODEL' in result).toBe(false);
  });

  it('api: injects base url + auth token, never the OAuth token or ANTHROPIC_MODEL', () => {
    const result = buildAgentEnv({
      type: 'api',
      baseUrl: 'https://api.example',
      token: 'api-tok',
    });
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.example');
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('api-tok');
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
    expect('CLAUDE_CODE_OAUTH_TOKEN' in result).toBe(false);
    // Model is passed via query options, never the env.
    expect('ANTHROPIC_MODEL' in result).toBe(false);
  });
});

describe('buildAgentEnv — empty-value stripping', () => {
  it('strips an empty OAuth token but keeps the config dir', () => {
    const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: '' });
    expect('CLAUDE_CODE_OAUTH_TOKEN' in result).toBe(false);
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
  });

  it('api: strips a null base url while keeping the auth token', () => {
    const result = buildAgentEnv({ type: 'api', baseUrl: null, token: 'api-tok' });
    expect('ANTHROPIC_BASE_URL' in result).toBe(false);
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('api-tok');
  });
});

describe('buildAgentEnv — env whitelist boundary', () => {
  it('always carries CLAUDE_CONFIG_DIR', () => {
    const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'tok' });
    expect(result.CLAUDE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
  });

  it('never forwards a non-whitelisted process.env key', () => {
    process.env.__AGENT_ENV_LEAK__ = 'secret';
    try {
      const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'tok' });
      expect('__AGENT_ENV_LEAK__' in result).toBe(false);
    } finally {
      process.env.__AGENT_ENV_LEAK__ = undefined;
    }
  });
});
