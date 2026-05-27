import { ProtocolClient } from '@moonshot-ai/kimi-agent-sdk';
import type { SlashCommand } from 'shared/types';
import { logger } from '../lib/logger';
import { SERVICE_NAME, SERVICE_VERSION } from '../version';

// Warm-init slash-command probe. The composer picker needs the slash commands
// available in a given workDir, but those come from the SDK's initialize
// handshake — not from the live session. We spin a short-lived ProtocolClient
// (no sessionId → not bound to a real session), read `init.slash_commands`,
// cache the result keyed by (workDir, skillsDir), and tear the client down.
//
// Cache is invalidated by `clearSlashCommandsCache()` (kimi-config PATCH) since
// editing skills/config changes the command list.

const cache = new Map<string, SlashCommand[]>();

function cacheKey(workDir: string, skillsDir?: string): string {
  return `${workDir}\0${skillsDir ?? ''}`;
}

export async function getSlashCommands(
  workDir: string,
  opts?: { skillsDir?: string; env?: Record<string, string>; cacheOnly?: boolean },
): Promise<SlashCommand[]> {
  const key = cacheKey(workDir, opts?.skillsDir);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  // `cacheOnly` callers (e.g. buildSnapshot) must never pay the warm-init
  // spawn latency — they read whatever is already cached, else an empty list.
  // The create/reconnect paths own the actual warm-init.
  if (opts?.cacheOnly) return [];

  const client = new ProtocolClient();
  try {
    const init = await client.start({
      workDir,
      clientInfo: { name: SERVICE_NAME, version: SERVICE_VERSION },
      ...(opts?.skillsDir ? { skillsDir: opts.skillsDir } : {}),
      ...(opts?.env ? { environmentVariables: opts.env } : {}),
    });
    // The SDK d.ts widens `slash_commands` to `any[]` (zod version skew), so
    // guard each entry rather than trusting the cast — a malformed item must
    // not poison the picker.
    const raw = (init.slash_commands ?? []) as unknown[];
    const commands: SlashCommand[] = raw.flatMap((c) => {
      if (c === null || typeof c !== 'object') return [];
      const { name, description, aliases } = c as Record<string, unknown>;
      if (typeof name !== 'string' || typeof description !== 'string') return [];
      return [{ name, description, aliases: Array.isArray(aliases) ? (aliases as string[]) : [] }];
    });
    cache.set(key, commands);
    return commands;
  } catch (err) {
    logger.warn({ err, workDir, skillsDir: opts?.skillsDir }, 'slash-commands warm-init failed');
    return [];
  } finally {
    // `stop()` may be called even when `start()` threw before spawning the
    // process; guard so teardown never masks the original error.
    try {
      await client.stop();
    } catch {
      // ignore
    }
  }
}

export function clearSlashCommandsCache(): void {
  cache.clear();
}
