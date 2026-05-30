import { eq } from 'drizzle-orm';
import type { ErrorPayload, StatusUpdatePayload, TitleUpdatePayload } from 'shared/types';
import { db, schema } from '../../db';
import { logger } from '../../lib/logger';
import { broadcastEvent } from '../../lib/ws-broadcast';
import type { ActiveSession } from '../session-manager';
import { sessionManager } from '../session-manager';

// Slash-command interceptor. Runs BEFORE a message reaches the SDK bridge: when
// the text is a recognized local command we handle it here and the caller skips
// `bridge.push`. Output is ephemeral — broadcast only, never persisted to the
// transcript. Unrecognized input (no leading `/` or unknown command) returns
// false so the caller forwards it to the model.

/** Effort levels accepted by `/effort`. `max` is omitted — the SDK
 *  `applyFlagSettings({ effortLevel })` flag layer does not accept it (it is
 *  only settable at query creation via `options.effort`). */
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh']);

/** Split a slash-command line into its name (without slash) and the remainder. */
function parseCommand(text: string): { name: string; arg: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const sliced = trimmed.slice(1);
  const spaceIdx = sliced.search(/\s/);
  if (spaceIdx === -1) return { name: sliced, arg: '' };
  return { name: sliced.slice(0, spaceIdx), arg: sliced.slice(spaceIdx + 1).trim() };
}

function broadcastError(active: ActiveSession, message: string): void {
  broadcastEvent<ErrorPayload>(
    active,
    'error',
    { code: 'slash_command', message, retryable: false },
    sessionManager,
  );
}

/**
 * Intercept and run a local slash command. Returns `true` when handled (caller
 * must NOT push the text to the bridge), `false` when the text is not a known
 * command and should be forwarded to the model.
 */
export async function tryHandleSlashCommand(active: ActiveSession, text: string): Promise<boolean> {
  const parsed = parseCommand(text);
  if (!parsed) return false;
  const { name, arg } = parsed;

  switch (name) {
    case 'status':
      await handleStatus(active);
      return true;
    case 'rename':
      await handleRename(active, arg);
      return true;
    case 'effort':
      await handleEffort(active, arg);
      return true;
    case 'mcp':
      await handleMcp(active);
      return true;
    case 'files':
      handleFiles(active);
      return true;
    default:
      return false;
  }
}

/** `/status` → read live context usage and broadcast a `status_update`. */
async function handleStatus(active: ActiveSession): Promise<void> {
  if (!active.query) {
    broadcastError(active, 'No active turn — /status is only available mid-session');
    return;
  }
  try {
    const usage = await active.query.getContextUsage();
    const payload: StatusUpdatePayload = {
      tokenUsage: usage.totalTokens,
      contextUsage: usage.percentage,
      ...(active.lastStatusUpdate?.totalCostUsd !== undefined
        ? { totalCostUsd: active.lastStatusUpdate.totalCostUsd }
        : {}),
    };
    broadcastEvent<StatusUpdatePayload>(active, 'status_update', payload, sessionManager);
  } catch (err) {
    logger.warn({ err, sessionId: active.sessionId }, '/status failed');
    broadcastError(active, 'Failed to read context usage');
  }
}

/** `/rename <title>` → persist the new title and broadcast `title_update`. */
async function handleRename(active: ActiveSession, arg: string): Promise<void> {
  const title = arg.trim();
  if (!title) {
    broadcastError(active, 'Usage: /rename <title>');
    return;
  }
  // sessions.title is varchar(255); clamp to stay within the column.
  const clamped = title.slice(0, 255);
  await db
    .update(schema.sessions)
    .set({ title: clamped })
    .where(eq(schema.sessions.id, active.sessionId));
  broadcastEvent<TitleUpdatePayload>(active, 'title_update', { title: clamped }, sessionManager);
}

/** `/effort <low|medium|high|xhigh>` → apply the effort flag mid-session. */
async function handleEffort(active: ActiveSession, arg: string): Promise<void> {
  const level = arg.trim().toLowerCase();
  if (!EFFORT_LEVELS.has(level)) {
    broadcastError(active, 'Usage: /effort <low|medium|high|xhigh>');
    return;
  }
  if (!active.query) {
    broadcastError(active, 'No active turn — /effort is only available mid-session');
    return;
  }
  try {
    await active.query.applyFlagSettings({
      effortLevel: level as 'low' | 'medium' | 'high' | 'xhigh',
    });
    broadcastEvent<StatusUpdatePayload>(
      active,
      'status_update',
      // Re-emit the latest known counters so the client can refresh; the effort
      // change itself carries no token delta.
      active.lastStatusUpdate ?? { tokenUsage: 0, contextUsage: 0 },
      sessionManager,
    );
  } catch (err) {
    logger.warn({ err, sessionId: active.sessionId, level }, '/effort failed');
    broadcastError(active, 'Failed to set effort level');
  }
}

/** `/mcp` → read-only MCP server status, surfaced as an informational line. */
async function handleMcp(active: ActiveSession): Promise<void> {
  if (!active.query) {
    broadcastError(active, 'No active turn — /mcp is only available mid-session');
    return;
  }
  try {
    const servers = await active.query.mcpServerStatus();
    const summary =
      servers.length === 0
        ? 'No MCP servers configured.'
        : servers.map((s) => `${s.name}: ${s.status}`).join('\n');
    // Reuse the `error` channel as a minimal info surface (retryable=false,
    // code distinguishes it from real errors). No dedicated info event exists.
    broadcastEvent<ErrorPayload>(
      active,
      'error',
      { code: 'mcp_status', message: summary, retryable: false },
      sessionManager,
    );
  } catch (err) {
    logger.warn({ err, sessionId: active.sessionId }, '/mcp failed');
    broadcastError(active, 'Failed to read MCP server status');
  }
}

/** `/files` → no dedicated files service is reachable here; note and stop. */
function handleFiles(active: ActiveSession): void {
  broadcastError(active, '/files is not available in this build');
}
