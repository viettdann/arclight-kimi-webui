import { eq } from 'drizzle-orm';
import type { ApprovalMode, SnapshotPayload } from 'shared/types';
import { type DB, db, schema } from '../db';
import { renderTranscript } from './agent/transcript-render';
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

  const [transcript] = await dbh
    .select()
    .from(schema.sessionTranscripts)
    .where(eq(schema.sessionTranscripts.sessionId, args.sessionId))
    .limit(1);

  const blocks = transcript
    ? renderTranscript(transcript.content, normalizeSubagents(transcript.subagents))
    : [];

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
    live: {
      turnInProgress: manager.peek(args.sessionId)?.turnInProgress ?? false,
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
    live: {
      turnInProgress: false,
    },
  };
}

/**
 * The `subagents` JSONB column stores `{ [filename]: fileContents }`. Coerce
 * the loosely-typed jsonb value into the `Record<string,string>` the renderer
 * expects, dropping any non-string entries defensively.
 */
function normalizeSubagents(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string') out[key] = val;
  }
  return out;
}
