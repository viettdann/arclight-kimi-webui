import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { BLACKLIST, type CommandInfo, STATIC_PASSTHROUGH } from 'shared/commands';
import type { CommandsAvailablePayload } from 'shared/types';
import { broadcastEvent } from '../../lib/ws-broadcast';
import type { ActiveSession, SessionManager } from '../session-manager';

// Per-workDir dynamic command/skill catalog, captured from a live session's
// `system/init`. Kept in a module-level map so the snapshot builder can read it
// without a live session in memory. Single-instance only — no cross-process
// coordination by design. Orchestrating the refresh here (not inline in the
// output consumer) keeps the build/broadcast logic unit-testable.

const catalogByWorkDir = new Map<string, CommandInfo[]>();

/** Store the catalog for a workDir, overwriting any previous entry. */
export function setCatalog(workDir: string, commands: CommandInfo[]): void {
  catalogByWorkDir.set(workDir, commands);
}

/** Read the catalog for a workDir; `undefined` until the first init populates it. */
export function getCatalog(workDir: string): CommandInfo[] | undefined {
  return catalogByWorkDir.get(workDir);
}

/**
 * Build the dynamic catalog from the SDK `system/init` lists and the rich
 * metadata returned by `Query.supportedCommands()`. Built-in passthrough
 * commands (compact/init) and blacklisted commands are excluded — built-ins
 * come from the static catalog and must never be duplicated here.
 */
export function buildCatalog(
  slashCommands: string[],
  skills: string[],
  rich: readonly SlashCommand[],
): CommandInfo[] {
  const richByName = new Map<
    string,
    { description: string; argumentHint: string; aliases?: string[] }
  >();
  for (const cmd of rich) {
    richByName.set(cmd.name, {
      description: cmd.description,
      argumentHint: cmd.argumentHint,
      ...(cmd.aliases ? { aliases: cmd.aliases } : {}),
    });
  }

  const skillSet = new Set(skills);
  const seen = new Set<string>();
  const out: CommandInfo[] = [];

  // Union of commands then skills, deduped by name, preserving order.
  for (const name of [...slashCommands, ...skills]) {
    if (seen.has(name)) continue;
    seen.add(name);
    // Built-ins live in the static catalog; never duplicate them here.
    if (BLACKLIST[name] !== undefined || STATIC_PASSTHROUGH.has(name)) continue;
    const meta = richByName.get(name);
    out.push({
      name,
      description: meta?.description ?? '',
      argumentHint: meta?.argumentHint ?? '',
      ...(meta?.aliases ? { aliases: meta.aliases } : {}),
      kind: skillSet.has(name) ? 'skill' : 'project',
    });
  }

  return out;
}

/**
 * Refresh and broadcast a session's dynamic catalog. Pulls rich metadata from
 * the live query (falling back to names-only when the call throws), builds the
 * catalog, stores it for the workDir, attaches it to the session, and broadcasts
 * a `commands_available` event to connected clients.
 */
export async function refreshCatalog(
  active: ActiveSession,
  slashCommands: string[],
  skills: string[],
  manager: SessionManager,
): Promise<void> {
  let rich: SlashCommand[] = [];
  try {
    rich = (await active.query?.supportedCommands()) ?? [];
  } catch {
    // Names-only fallback: build the catalog without rich metadata.
  }
  const commands = buildCatalog(slashCommands, skills, rich);
  setCatalog(active.workDir, commands);
  active.commands = commands;
  broadcastEvent<CommandsAvailablePayload>(active, 'commands_available', { commands }, manager);
}
