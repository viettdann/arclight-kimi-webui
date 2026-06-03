import { describe, expect, it } from 'bun:test';
import { buildAgentEnv, pickSafeEnv, SAFE_ENV_KEYS } from '../../src/services/agent/env';

// `buildAgentEnv` is a pure, synchronous mapping from a resolved provider row +
// per-user paths to the subprocess env. No DB/getConfig involved — provider
// resolution happens upstream (resolve.ts) and the paths come from agent-paths.

// Fixed per-user paths used across the buildAgentEnv tests. They stand in for
// what `agentHomeFor(cwd)` / `agentConfigDirFor(cwd)` resolve to at call sites.
const PATHS = { home: '/ws/dan.le', configDir: '/state/dan.le' };

describe('pickSafeEnv', () => {
  it('copies only whitelisted keys present in the source', () => {
    const src = {
      PATH: '/usr/bin',
      USER: 'x',
      NOT_SAFE: 'leak',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    };
    expect(pickSafeEnv(SAFE_ENV_KEYS, src)).toEqual({ PATH: '/usr/bin', USER: 'x' });
  });

  it('does not carry HOME — HOME is no longer a safe-forward key', () => {
    const src = { PATH: '/usr/bin', HOME: '/home/host', USER: 'x' };
    expect(pickSafeEnv(SAFE_ENV_KEYS, src)).toEqual({ PATH: '/usr/bin', USER: 'x' });
  });

  it('drops keys with empty/undefined values', () => {
    const src = { PATH: '/usr/bin', USER: '', TERM: undefined };
    expect(pickSafeEnv(SAFE_ENV_KEYS, src)).toEqual({ PATH: '/usr/bin' });
  });

  it('honors a custom key list', () => {
    const src = { PATH: '/usr/bin', USER: 'x' };
    expect(pickSafeEnv(['USER'], src)).toEqual({ USER: 'x' });
  });

  it('returns an empty object when nothing matches', () => {
    expect(pickSafeEnv(SAFE_ENV_KEYS, { FOO: 'bar' })).toEqual({});
  });
});

describe('buildAgentEnv — provider env shape', () => {
  it('oauth: injects only the OAuth token + per-user paths, never Anthropic vars', () => {
    const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'oauth-tok' }, PATHS);
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-tok');
    expect(result.HOME).toBe(PATHS.home);
    expect(result.CLAUDE_CONFIG_DIR).toBe(PATHS.configDir);
    expect('ANTHROPIC_BASE_URL' in result).toBe(false);
    expect('ANTHROPIC_AUTH_TOKEN' in result).toBe(false);
    expect('ANTHROPIC_MODEL' in result).toBe(false);
  });

  it('api: injects base url + auth token, never the OAuth token or ANTHROPIC_MODEL', () => {
    const result = buildAgentEnv(
      { type: 'api', baseUrl: 'https://api.example', token: 'api-tok' },
      PATHS,
    );
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.example');
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('api-tok');
    expect(result.HOME).toBe(PATHS.home);
    expect(result.CLAUDE_CONFIG_DIR).toBe(PATHS.configDir);
    expect('CLAUDE_CODE_OAUTH_TOKEN' in result).toBe(false);
    // Model is passed via query options, never the env.
    expect('ANTHROPIC_MODEL' in result).toBe(false);
  });
});

describe('buildAgentEnv — empty-value stripping', () => {
  it('strips an empty OAuth token but keeps the per-user paths', () => {
    const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: '' }, PATHS);
    expect('CLAUDE_CODE_OAUTH_TOKEN' in result).toBe(false);
    expect(result.HOME).toBe(PATHS.home);
    expect(result.CLAUDE_CONFIG_DIR).toBe(PATHS.configDir);
  });

  it('api: strips a null base url while keeping the auth token', () => {
    const result = buildAgentEnv({ type: 'api', baseUrl: null, token: 'api-tok' }, PATHS);
    expect('ANTHROPIC_BASE_URL' in result).toBe(false);
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('api-tok');
  });
});

describe('buildAgentEnv — host isolation', () => {
  it('always carries the per-user HOME + CLAUDE_CONFIG_DIR', () => {
    const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'tok' }, PATHS);
    expect(result.HOME).toBe(PATHS.home);
    expect(result.CLAUDE_CONFIG_DIR).toBe(PATHS.configDir);
  });

  it('never forwards the host HOME — uses the per-user path instead', () => {
    const prev = process.env.HOME;
    process.env.HOME = '/home/host-leak';
    try {
      const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'tok' }, PATHS);
      expect(result.HOME).toBe(PATHS.home);
      expect(result.HOME).not.toBe('/home/host-leak');
    } finally {
      if (prev === undefined) process.env.HOME = undefined;
      else process.env.HOME = prev;
    }
  });

  it('never forwards a non-whitelisted process.env key', () => {
    process.env.__AGENT_ENV_LEAK__ = 'secret';
    try {
      const result = buildAgentEnv({ type: 'oauth', baseUrl: null, token: 'tok' }, PATHS);
      expect('__AGENT_ENV_LEAK__' in result).toBe(false);
    } finally {
      process.env.__AGENT_ENV_LEAK__ = undefined;
    }
  });
});
