import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SlashCommand } from 'shared/types';
import { logger } from '../lib/logger';
import { buildAgentEnv, getClaudeCodePath } from './agent/env';
import { createMessageBridge } from './agent/message-bridge';

// Warm-init slash-command probe. The composer picker needs the slash commands
// available in a given workDir; those come from the SDK's `system`/`init`
// handshake — not from a live turn. We spin a short-lived `query()` with an
// empty input bridge (no prompt pushed) and `persistSession: false`, wait for
// the `init` message, read `query.supportedCommands()`, cache the result keyed
// by `workDir`, then abort the query and close the bridge.
//
// The live session also populates the cache from its own `system`/`init`
// message via `setSlashCommands`, so the picker survives without paying the
// warm-init spawn latency once a session is running.
//
// Cache is invalidated by `clearSlashCommandsCache()` (config PATCH) since
// editing skills/config changes the command list.

const cache = new Map<string, SlashCommand[]>();

/** How long to wait for the warm-init `system`/`init` message before bailing. */
const WARM_INIT_TIMEOUT_MS = 15_000;

/** Map an SDK `SlashCommand` (`{name, description, argumentHint, aliases?}`) to
 *  the wire `SlashCommand` (`{name, description, aliases}`). Guards each field
 *  so a malformed entry can never poison the picker. */
function toWireCommand(c: unknown): SlashCommand[] {
  if (c === null || typeof c !== 'object') return [];
  const { name, description, aliases } = c as Record<string, unknown>;
  if (typeof name !== 'string') return [];
  return [
    {
      name,
      description: typeof description === 'string' ? description : '',
      aliases: Array.isArray(aliases)
        ? (aliases.filter((a) => typeof a === 'string') as string[])
        : [],
    },
  ];
}

/**
 * Resolve the slash commands available in `workDir`. Returns the cached list
 * when present; otherwise runs the warm-init probe (unless `cacheOnly`, which
 * never pays the spawn latency and returns an empty list on a miss).
 */
export async function getSlashCommands(
  workDir: string,
  opts?: { skillsDir?: string; env?: Record<string, string>; cacheOnly?: boolean },
): Promise<SlashCommand[]> {
  const cached = cache.get(workDir);
  if (cached !== undefined) return cached;
  // `cacheOnly` callers (e.g. buildSnapshot) must never pay the warm-init spawn
  // latency — they read whatever is already cached, else an empty list. The
  // create/reconnect paths own the actual warm-init.
  if (opts?.cacheOnly) return [];

  const commands = await warmInit(workDir, opts?.env);
  cache.set(workDir, commands);
  return commands;
}

/**
 * Populate the cache for `workDir` from an already-observed `system`/`init`
 * message. Called by the live session so the picker is hot without a separate
 * warm-init spawn.
 */
export function setSlashCommands(workDir: string, cmds: SlashCommand[]): void {
  cache.set(workDir, cmds);
}

export function clearSlashCommandsCache(): void {
  cache.clear();
}

/**
 * Spin a short-lived `query()` to read the supported commands for a workDir.
 * Drains the stream until the `init` message, fetches `supportedCommands()`,
 * then aborts. Best-effort: any failure yields an empty list (logged).
 */
async function warmInit(
  workDir: string,
  envOverride?: Record<string, string>,
): Promise<SlashCommand[]> {
  const abortController = new AbortController();
  const bridge = createMessageBridge(`warm-init:${workDir}`);
  const timer = setTimeout(() => abortController.abort(), WARM_INIT_TIMEOUT_MS);

  try {
    const [pathToClaudeCodeExecutable, env] = await Promise.all([
      getClaudeCodePath(),
      envOverride ? Promise.resolve(envOverride) : buildAgentEnv(),
    ]);

    const q = query({
      prompt: bridge.iterable,
      options: {
        settingSources: ['project'],
        cwd: workDir,
        abortController,
        persistSession: false,
        includePartialMessages: false,
        pathToClaudeCodeExecutable,
        env,
        stderr: (line: string) => logger.debug({ line }, 'slash-commands warm-init stderr'),
      },
    });

    // Drain until the `init` system message, then the control channel is ready
    // for `supportedCommands()`.
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') break;
    }

    const raw = await q.supportedCommands();
    const commands = raw.flatMap(toWireCommand);
    return commands;
  } catch (err) {
    logger.warn({ err, workDir }, 'slash-commands warm-init failed');
    return [];
  } finally {
    clearTimeout(timer);
    // Abort the subprocess and close the input bridge so iteration ends.
    try {
      abortController.abort();
    } catch {
      // already aborted
    }
    bridge.close();
  }
}
