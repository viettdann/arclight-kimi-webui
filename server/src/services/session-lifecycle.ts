import { eq } from 'drizzle-orm';
import { type DB, db as defaultDb, schema } from '../db';
import { logger } from '../lib/logger';
import { clearLocalSession } from './agent/transcript-store';
import type { ActiveSession, SessionManager } from './session-manager';

// Single source of truth for tearing an in-memory session down. Both the REST
// `DELETE /api/sessions/:id` route and project deletion funnel through
// `teardownActiveSession` so concurrency and backup semantics stay identical.
//
// Teardown interrupts the live query, kills the subprocess, clears the local
// scratch JSONL (the DB store already holds the transcript), and frees the
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
 *      promises so nothing deadlocks during teardown.
 *   4. Abort the subprocess + close the input bridge.
 *   5. `clearLocalSession` — free the local scratch JSONL (RAM hygiene; the DB
 *      store already holds the transcript).
 *   6. Mark the row `status='idle'` (the row itself is kept).
 *   7. `manager.unregister(id)` — free the in-memory slot.
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

  // The SDK store mirror already holds the transcript (eager dual-write), so
  // there is no final flush. Free the local scratch JSONL as RAM hygiene — the
  // DB store is the source of truth and a later resume rematerializes from it.
  if (active.sdkSessionId) {
    await clearLocalSession(active.workDir, active.sdkSessionId);
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
