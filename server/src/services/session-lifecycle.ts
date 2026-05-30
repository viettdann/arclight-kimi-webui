import { eq } from 'drizzle-orm';
import { type DB, db as defaultDb, schema } from '../db';
import { logger } from '../lib/logger';
import { appendTranscript, backupSubagents } from './agent/transcript-store';
import type { ActiveSession, SessionManager } from './session-manager';

// Single source of truth for tearing an in-memory session down. Both the REST
// `DELETE /api/sessions/:id` route and project deletion funnel through
// `teardownActiveSession` so concurrency and backup semantics stay identical.
//
// Teardown interrupts the live query, flushes the final transcript backup (so
// the session stays resumable from the DB), kills the subprocess, and frees the
// in-memory slot. It does NOT delete the row — that is the caller's job. It does
// NOT close attached WebSocket connections; a single socket may be attached to
// many sessions, and closing it would kill the others.

export interface TeardownDeps {
  manager: SessionManager;
  db?: DB;
}

/**
 * Idempotent teardown of an in-memory session. Step-by-step:
 *   1. Race guard: `manager.tryBeginClose(id)` — atomic claim. Loser bails.
 *   2. Best-effort `query?.interrupt()` — stop the consumer emitting more.
 *   3. `manager.drainPendingRequests(active)` — settle hanging canUseTool
 *      promises so nothing deadlocks while we await the backup mutex.
 *   4. Abort the subprocess + close the input bridge.
 *   5. `await active.backupMutex` — let the last in-flight backup finish.
 *   6. Best-effort final transcript + subagent backup so the session stays
 *      resumable from the DB.
 *   7. Mark the row `status='idle'` (the row itself is kept).
 *   8. `manager.unregister(id)` — free the in-memory slot.
 *
 * The subprocess is aborted exactly once across concurrent callers because
 * `tryBeginClose` lets only one path through.
 */
export async function teardownActiveSession(
  active: ActiveSession,
  deps: TeardownDeps,
): Promise<void> {
  const { manager } = deps;
  const dbh = deps.db ?? defaultDb;

  // Synchronous race claim — flips `active.closing` before the first await
  // below. Concurrent losers (or retries after unregister) observe `false`
  // here and exit cleanly.
  if (!manager.tryBeginClose(active.sessionId)) return;

  try {
    await active.query?.interrupt();
  } catch {
    // best-effort — the query may already be finalized.
  }

  // CRITICAL — settle any awaited canUseTool/AskUserQuestion promise so the
  // consumer is not blocked on a permission prompt while we tear down.
  manager.drainPendingRequests(active);

  active.abortController?.abort();
  active.bridge?.close();

  // Drain backup. Catch defensively — the consumer always reassigns
  // backupMutex to a never-rejecting promise, but a stale chain shouldn't take
  // down teardown.
  try {
    await active.backupMutex;
  } catch {
    // ignore
  }

  // Final flush so the transcript on disk (which the binary may have appended
  // past the last backup) is captured before the slot is freed. Skipped when no
  // SDK session ever materialized — there is nothing on disk to back up.
  if (active.sdkSessionId) {
    try {
      await appendTranscript(active.sessionId, active.sdkSessionId, active.workDir);
      await backupSubagents(active.sessionId, active.sdkSessionId, active.workDir);
    } catch (err) {
      logger.error(
        { err, sessionId: active.sessionId },
        'Failed to flush final transcript backup on teardown',
      );
    }
  }

  try {
    await dbh
      .update(schema.sessions)
      .set({ status: 'idle' })
      .where(eq(schema.sessions.id, active.sessionId));
  } catch (err) {
    logger.error({ err, sessionId: active.sessionId }, 'Failed to mark session idle on teardown');
  }

  manager.unregister(active.sessionId);
}
