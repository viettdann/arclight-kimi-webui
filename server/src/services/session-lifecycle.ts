import { type DB, db as defaultDb } from '../db';
import { logger } from '../lib/logger';
import { appendWireDelta, flushContextAndState } from './kimi-session';
import type { ActiveSession, KimiSessionManager } from './session-manager';

// Single source of truth for tearing an in-memory session down. Both the REST
// `DELETE /api/sessions/:id` route and project deletion funnel through
// `teardownActiveSession` so concurrency and backup semantics stay identical.
//
// Teardown flushes the final backup (so the transcript stays resumable from the
// DB), closes the SDK, and frees the in-memory slot. It does NOT delete the row
// — that is the caller's job. It does NOT close attached WebSocket connections;
// a single socket may be attached to many sessions, and closing it would kill
// the others.

export interface TeardownDeps {
  manager: KimiSessionManager;
  db?: DB;
}

/**
 * Idempotent teardown of an in-memory session. Step-by-step:
 *   1. Race guard: `manager.tryBeginClose(id)` — atomic claim. Loser bails.
 *   2. Best-effort `currentTurn?.interrupt()` — stop pump emitting more events.
 *   3. `await active.backupMutex` — let the last in-flight backup finish.
 *   4. Flush wire + context/state to DB so the session stays resumable.
 *   5. Best-effort `kimiSession.close()` — release SDK + fs handle.
 *   6. `manager.unregister(id)` — free in-memory slot.
 *
 * `kimiSession.close()` runs exactly once across concurrent callers because
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

  if (active.currentTurn !== null) {
    try {
      await active.currentTurn.interrupt();
    } catch {
      // best-effort
    }
  }

  // Drain backup. Catch defensively — pump always reassigns backupMutex to a
  // never-rejecting promise, but a stale chain shouldn't take down teardown.
  try {
    await active.backupMutex;
  } catch {
    // ignore
  }

  try {
    await appendWireDelta(active, true, dbh);
    await flushContextAndState(active, dbh);
  } catch (err) {
    logger.error(
      { err, sessionId: active.sessionId },
      'Failed to flush wire or context/state on teardown',
    );
  }

  try {
    await active.kimiSession.close();
  } catch {
    // best-effort — SDK may already be torn down
  }

  manager.unregister(active.sessionId);
}
