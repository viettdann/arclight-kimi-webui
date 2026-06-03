import { classifyCommand, parseSlashCommand } from 'shared/commands';
import type { ActiveSession } from '../session-manager';

// Defensive slash-command guard. Runs BEFORE a message reaches the SDK bridge.
// The client picker already filters web-unsupported commands, so this is a
// last-resort check: a slash command that classifies as `unsupported` (a
// blacklisted native command, or — once the session's dynamic catalog is known
// — an unknown name) is swallowed here, costing no flag write, no query spawn,
// and no turn. Everything else (passthrough commands and plain text) returns
// false so the caller forwards it to the model.

/**
 * Returns `true` when the text is a slash command the web UI does not support
 * (caller must swallow it), `false` otherwise (caller forwards to the bridge).
 */
export function tryHandleSlashCommand(active: ActiveSession, text: string): boolean {
  const parsed = parseSlashCommand(text);
  if (!parsed) return false;
  const result = classifyCommand(parsed.name, {
    dynamic: active.commands?.map((c) => c.name),
  });
  return result.type === 'unsupported';
}
