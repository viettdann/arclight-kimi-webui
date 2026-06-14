import { logger } from '../../lib/logger';
import type { SessionManager } from '../session-manager';
import { disposeQuery } from './query-runner';

// Background GC for idle `claude` subprocesses. A session keeps its subprocess
// alive across turns (one spawn per session, reused), which holds memory/PID
// indefinitely even long after the user stopped interacting. This reaper sweeps
// in-memory sessions on an interval and disposes any subprocess idle past the
// TTL — the session row stays in memory and respawns lazily on the next turn, so
// the only user-visible effect is a one-time spawn cost when they return.
//
// Single-instance by design: a plain in-process timer, no coordination.

const log = logger.child({ module: 'agent/idle-reaper' });

/** Dispose every subprocess idle longer than `ttlMs`. Best-effort per session.
 *  Exported for tests; production calls it via the interval in
 *  `startIdleQueryReaper`. */
export async function reapIdleQueries(
  manager: SessionManager,
  ttlMs: number,
  now: number,
): Promise<void> {
  for (const active of manager.allSessions()) {
    if (!active.query) continue; // already disposed / never spawned
    if (active.turnInProgress) continue; // never reap an in-flight turn
    if (active.closing) continue; // teardown already owns it
    if (active.pendingApprovals.size > 0 || active.pendingQuestions.size > 0) continue;
    const idleMs = now - active.lastActivity;
    if (idleMs < ttlMs) continue;
    log.info({ sessionId: active.sessionId, idleMs }, 'reaping idle query subprocess');
    try {
      await disposeQuery(active);
    } catch (err) {
      log.warn({ err, sessionId: active.sessionId }, 'idle reaper dispose failed');
    }
  }
}

/**
 * Start the idle-query reaper. Returns a stop function (clears the interval).
 * The timer is unref'd so it never keeps the process alive on its own.
 */
export function startIdleQueryReaper(
  manager: SessionManager,
  opts: { ttlMs: number; sweepMs: number },
): () => void {
  const timer = setInterval(() => {
    void reapIdleQueries(manager, opts.ttlMs, Date.now()).catch((err) => {
      log.warn({ err }, 'idle reaper sweep failed');
    });
  }, opts.sweepMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
