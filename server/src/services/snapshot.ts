import { eq } from 'drizzle-orm';
import type { ApprovalMode, EffortLevel, SnapshotPayload } from 'shared/types';
import { type DB, db, schema } from '../db';
import { getCatalog } from './agent/commands-catalog';
import { readSessionEntries } from './agent/session-store';
import { renderEntries } from './agent/transcript-render';
import { type SessionManager, sessionManager } from './session-manager';

export interface BuildSnapshotArgs {
  sessionId: string;
  /** Defaults to the process singleton when omitted. */
  manager?: SessionManager;
  db?: DB;
}

/**
 * Reconstruct a session's full UI state from the persisted transcript plus the
 * sessions row, with the only live overlay being whether a turn is in flight.
 * Returns `null` when the session row is absent (callers map that to
 * `not_found`). Pure read — never spawns a warm-init probe or touches the SDK.
 */
export async function buildSnapshot(args: BuildSnapshotArgs): Promise<SnapshotPayload | null> {
  const dbh = args.db ?? db;
  const manager = args.manager ?? sessionManager;

  const [sessRow] = await dbh
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, args.sessionId))
    .limit(1);
  if (!sessRow) return null;

  // A session absent from the manager (e.g. killed by a restart) is not running
  // a turn, so its dangling tool_calls were interrupted, not still executing.
  const activeSession = manager.peek(args.sessionId);
  const turnInProgress = activeSession?.turnInProgress ?? false;

  // Render from the DB store keyed by the SDK session id (the single source of
  // truth). Absent until the first turn materializes a session id → empty.
  let blocks: SnapshotPayload['blocks'] = [];
  if (sessRow.sdkSessionId) {
    const { main, subagents } = await readSessionEntries(dbh, sessRow.sdkSessionId);
    blocks = renderEntries(main, subagents, { terminal: !turnInProgress });
  }

  const pendingPrompt =
    sessRow.pendingPrompt != null && sessRow.pendingEnqueuedAt != null
      ? { text: sessRow.pendingPrompt, enqueuedAt: sessRow.pendingEnqueuedAt.toISOString() }
      : null;

  return {
    blocks,
    totalTokens: sessRow.totalTokens,
    totalCostUsd: Number(sessRow.totalCostUsd),
    title: sessRow.title,
    pendingPrompt,
    thinking: sessRow.thinking,
    approvalMode: sessRow.approvalMode as ApprovalMode,
    effort: (sessRow.effort as EffortLevel | null) ?? null,
    ultracode: sessRow.ultracode,
    commands: getCatalog(sessRow.workDir) ?? [],
    contextUsage: activeSession?.lastContextUsage ?? null,
    live: {
      turnInProgress,
    },
  };
}

/**
 * Canonical zero-state snapshot for a freshly created session with no
 * transcript, no pending prompt, no live turn. Keeping this in one place means
 * any future addition to `SnapshotPayload` only needs to update the type and
 * `buildSnapshot` — broadcast callers stay correct automatically.
 */
export function emptySnapshot(): SnapshotPayload {
  return {
    blocks: [],
    totalTokens: 0,
    totalCostUsd: 0,
    title: null,
    pendingPrompt: null,
    thinking: false,
    approvalMode: 'ask',
    effort: null,
    ultracode: false,
    commands: [],
    contextUsage: null,
    live: {
      turnInProgress: false,
    },
  };
}
