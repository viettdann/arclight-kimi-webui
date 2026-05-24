import { eq } from 'drizzle-orm';
import type { SessionStatePayload, SessionStateReason } from 'shared/types';
import { type DB, db as defaultDb, schema } from '../db';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { broadcastEvent } from '../lib/ws-broadcast';
import { appendWireDelta, flushContextAndState } from './kimi-session';
import type { ActiveSession, KimiSessionManager } from './session-manager';

// Single source of truth for session teardown. Both the REST `POST
// /api/sessions/:id/close` route and the WS `close_session` handler must funnel
// through `closeActiveSession` so concurrency, audit, and broadcast semantics
// stay identical.
//
// Helper does NOT close attached WebSocket connections. Clients receive
// `session_state{state:'closed', reason}` and decide whether to drop the socket
// or subscribe to another session — a single socket may be attached to many
// sessions, and closing it would kill the others.

export interface CloseDeps {
  manager: KimiSessionManager;
  db?: DB;
  auditLog?: typeof defaultAuditLog;
}

export interface CloseOpts {
  reason: SessionStateReason;
}

/**
 * Idempotent teardown of an in-memory session. Step-by-step:
 *   1. Race guard: `manager.tryBeginClose(id)` — atomic claim. Loser bails;
 *      audit/broadcast are skipped (winner emits them).
 *   2. Best-effort `currentTurn?.interrupt()` — stop pump emitting more events.
 *   3. `await active.backupMutex` — let the last in-flight backup finish.
 *   4. Best-effort `kimiSession.close()` — release SDK + fs handle.
 *   5. DB: `sessions.status := 'closed'` (durable).
 *   6. Broadcast `session_state{closed, reason}` — buffer-stamped seq is the
 *      highest of this session because pump is dead.
 *   7. Audit log `{action:'session_close', source:reason, path:sessionId}`.
 *   8. `manager.unregister(id)` — free in-memory slot.
 *
 * `kimiSession.close()` is called exactly once across REST + WS races because
 * `tryBeginClose` lets only one path through.
 */
export async function closeActiveSession(
  active: ActiveSession,
  deps: CloseDeps,
  opts: CloseOpts,
): Promise<void> {
  const { manager } = deps;
  const dbh = deps.db ?? defaultDb;
  const audit = deps.auditLog ?? defaultAuditLog;

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
  // never-rejecting promise, but a stale chain shouldn't take down close.
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
      'Failed to flush wire or context/state on close',
    );
  }

  try {
    await active.kimiSession.close();
  } catch {
    // best-effort — SDK may already be torn down
  }

  await dbh
    .update(schema.sessions)
    .set({ status: 'closed' })
    .where(eq(schema.sessions.id, active.sessionId));

  // Broadcast last so seq is the highest event of this session. Pump is dead
  // (interrupt + iterator drained), so no more events can race past this.
  broadcastEvent<SessionStatePayload>(
    active,
    'session_state',
    { state: 'closed', reason: opts.reason },
    manager,
  );

  audit({
    userId: active.userId,
    action: 'session_close',
    path: active.sessionId,
    bytes: 0,
    source: opts.reason,
  });

  manager.unregister(active.sessionId);
}
