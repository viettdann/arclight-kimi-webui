import { validateAuthSessions } from '../auth/session-check';
import { logger } from '../lib/logger';
import { closeAuthExpired } from './close-codes';
import { snapshot } from './registry';

export const WS_HEARTBEAT_MS = 60_000;

/**
 * Periodic auth-session revalidation. Snapshots the socket registry every
 * `WS_HEARTBEAT_MS`, batch-queries the BetterAuth `session` table, and closes
 * any socket whose backing row is missing or expired with code 4401. Survives
 * transient DB errors — interval keeps firing, no socket is closed during a
 * failed cycle.
 *
 * Returns a stop fn the caller wires into SIGTERM/SIGINT.
 */
export function startWsHeartbeat(intervalMs: number = WS_HEARTBEAT_MS): () => void {
  const timer = setInterval(() => {
    void runCycle();
  }, intervalMs);
  // Bun's setInterval returns a Timer with `.unref()`. CLAUDE.md pins the
  // runtime to bun, so no feature-test is needed.
  timer.unref?.();
  return () => clearInterval(timer);
}

async function runCycle(): Promise<void> {
  const sockets = snapshot();
  if (sockets.length === 0) return;

  // Dedup ids — multiple sockets may share one auth session (multi-tab).
  const ids = Array.from(new Set(sockets.map((s) => s.data.authSessionId)));

  let valid: Set<string>;
  try {
    valid = await validateAuthSessions(ids);
  } catch (err) {
    logger.error({ err }, 'ws heartbeat: session validation failed; skipping cycle');
    return;
  }

  const now = Date.now();
  for (const ws of sockets) {
    if (valid.has(ws.data.authSessionId)) {
      ws.data.lastValidatedAt = now;
    } else {
      closeAuthExpired(ws);
    }
  }
}
