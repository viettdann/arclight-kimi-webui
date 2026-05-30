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

/** Cached `claude` CLI path — resolved once per process. */
let cachedClaudePath: string | undefined;

/**
 * Resolve the absolute path of the `claude` binary via `which`. Cached.
 * Throws when the binary is absent — the plan assumes it always exists.
 */
export async function getClaudeCodePath(): Promise<string> {
  if (cachedClaudePath) return cachedClaudePath;

  const proc = Bun.spawn(['which', 'claude'], { stdout: 'pipe', stderr: 'ignore' });
  const output = (await new Response(proc.stdout).text()).trim();
  await proc.exited;

  if (!output) throw new Error('claude executable not found on PATH');

  cachedClaudePath = output;
  return cachedClaudePath;
}

/**
 * Build the env map for the SDK subprocess. Baseline safe keys plus the
 * provider-specific auth vars. Empty/undefined values are stripped before
 * returning. Since `options.env` replaces process.env, the baseline is always
 * included.
 */
export async function buildAgentEnv(): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    ...pickSafeEnv(),
    CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR,
  };

  const provider = await getConfig('CLAUDE_PROVIDER');

  if (provider === 'api') {
    base.ANTHROPIC_BASE_URL = (await getConfig('ANTHROPIC_BASE_URL')) ?? '';
    base.ANTHROPIC_AUTH_TOKEN = (await getConfig('ANTHROPIC_AUTH_TOKEN')) ?? '';
    base.ANTHROPIC_MODEL = (await getConfig('ANTHROPIC_MODEL')) ?? '';
  } else {
    base.CLAUDE_CODE_OAUTH_TOKEN = (await getConfig('CLAUDE_CODE_OAUTH_TOKEN')) ?? '';
  }

  // Strip empty/undefined values so we never hand the subprocess a blank token.
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value) result[key] = value;
  }
  return result;
}
