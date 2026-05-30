import type { ClaudeProvider } from 'shared/types/config';
import { env } from '../../env';
import { getConfig } from '../config';

/**
 * Whitelist of env vars safe to forward to the SDK subprocess. `options.env`
 * REPLACES the subprocess's process.env entirely, so these baseline keys
 * (PATH/HOME/...) are mandatory for the `claude` binary to run.
 */
export const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
] as const;

/** Copy the present keys from `src` into a fresh record. */
export function pickSafeEnv(
  keys: readonly string[] = SAFE_ENV_KEYS,
  src: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = src[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * The provider auth config in its resolved, plaintext form. Empty string means
 * "unset" for any field. The `/test` route also builds this from a draft
 * override merged over the saved values.
 */
export interface ProviderAuthConfig {
  provider: ClaudeProvider;
  oauthToken: string;
  baseUrl: string;
  authToken: string;
  model: string;
}

/** Resolve the saved provider config from the DB > ENV > default chain. */
export async function resolveSavedProviderConfig(): Promise<ProviderAuthConfig> {
  const provider = (await getConfig('CLAUDE_PROVIDER')) === 'api' ? 'api' : 'oauth';
  return {
    provider,
    oauthToken: (await getConfig('CLAUDE_CODE_OAUTH_TOKEN')) ?? '',
    baseUrl: (await getConfig('ANTHROPIC_BASE_URL')) ?? '',
    authToken: (await getConfig('ANTHROPIC_AUTH_TOKEN')) ?? '',
    model: (await getConfig('ANTHROPIC_MODEL')) ?? '',
  };
}

/**
 * Build the env map for the SDK subprocess from a resolved provider config.
 * Baseline safe keys plus the provider-specific auth vars. Empty/undefined
 * values are stripped, so we never hand the subprocess a blank token (which
 * would let the `claude` binary silently fall back to ambient credentials).
 * Since `options.env` replaces process.env, the baseline is always included.
 */
export function envFromProviderConfig(cfg: ProviderAuthConfig): Record<string, string> {
  const base: Record<string, string> = {
    ...pickSafeEnv(),
    CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR,
  };

  if (cfg.provider === 'api') {
    base.ANTHROPIC_BASE_URL = cfg.baseUrl;
    base.ANTHROPIC_AUTH_TOKEN = cfg.authToken;
    base.ANTHROPIC_MODEL = cfg.model;
  } else {
    base.CLAUDE_CODE_OAUTH_TOKEN = cfg.oauthToken;
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value) result[key] = value;
  }
  return result;
}

/** Env map for the agent subprocess, built from the saved provider config. */
export async function buildAgentEnv(): Promise<Record<string, string>> {
  return envFromProviderConfig(await resolveSavedProviderConfig());
}
