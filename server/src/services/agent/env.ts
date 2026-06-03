/**
 * Whitelist of env vars safe to forward to the SDK subprocess. `options.env`
 * REPLACES the subprocess's process.env entirely, so these baseline keys (PATH/
 * USER/...) are mandatory for the `claude` binary to run. `HOME` is NOT here —
 * it is set per-user by `buildAgentEnv` so the agent never reads the host's
 * `$HOME` (and thus never the host's `~/.claude/CLAUDE.md`).
 */
export const SAFE_ENV_KEYS = [
  'PATH',
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

/** Resolved provider fields needed to build a subprocess env. A ProviderRow is
 *  assignable to this — `type` is `string` so no cast is needed at call sites. */
export interface ProviderEnvInput {
  type: string;
  baseUrl: string | null;
  token: string;
}

/** Per-user (or ephemeral) home + config dir, resolved from the session cwd by
 *  `agent-paths`. These isolate the agent's memory and state from the host. */
export interface AgentPaths {
  home: string;
  configDir: string;
}

/**
 * Build the env map for the SDK subprocess from a provider row (or equivalent
 * input) plus the resolved per-user paths. Synchronous — no DB or config reads.
 * Empty/undefined values are stripped so the subprocess never receives a blank
 * token.
 *
 * `options.env` replaces process.env entirely, so the safe baseline is always
 * included. `HOME` and `CLAUDE_CONFIG_DIR` come from `paths` (never the host),
 * isolating the agent's memory and state per user. ANTHROPIC_MODEL is
 * intentionally omitted — it is passed via query options at call sites.
 */
export function buildAgentEnv(
  provider: ProviderEnvInput,
  paths: AgentPaths,
): Record<string, string> {
  const base: Record<string, string> = {
    ...pickSafeEnv(),
    HOME: paths.home,
    CLAUDE_CONFIG_DIR: paths.configDir,
  };

  if (provider.type === 'api') {
    if (provider.baseUrl) base.ANTHROPIC_BASE_URL = provider.baseUrl;
    base.ANTHROPIC_AUTH_TOKEN = provider.token;
  } else {
    base.CLAUDE_CODE_OAUTH_TOKEN = provider.token;
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value) result[key] = value;
  }
  return result;
}
