import type { ServerWebSocket } from 'bun';
import type { WSMessage, WSMessageType } from 'shared/types';
import type { ActiveSession, KimiSessionManager } from '../services/session-manager';
import type { WSData } from '../ws/upgrade';

// `ws.readyState === 1` is the OPEN state for Bun's ServerWebSocket (matches the
// browser WebSocket constant). Skip non-OPEN sockets so a dying client cannot
// throw mid-broadcast and abort the iteration.
const WS_OPEN = 1;

/**
 * Build a WS envelope, push it into the per-session ring buffer, and fan out
 * to every attached socket. Returns the built message so callers can chain
 * (e.g. emit DB log alongside).
 *
 * Caller invariant: `manager.allocSeq(active)` is the only place seqs are
 * minted; doing it here ensures buffer order matches wire order.
 */
export function broadcastEvent<T>(
  active: ActiveSession,
  type: WSMessageType,
  payload: T,
  manager: KimiSessionManager,
): WSMessage<T> {
  const seq = manager.allocSeq(active);
  const msg: WSMessage<T> = {
    type,
    payload,
    sessionId: active.sessionId,
    seq,
    timestamp: Date.now(),
  };
  active.eventBuffer.push(msg as WSMessage);
  const serialized = JSON.stringify(msg);
  for (const ws of active.wsSet) {
    if (ws.readyState !== WS_OPEN) continue;
    try {
      ws.send(serialized);
    } catch {
      // Socket closed between readyState check and send; ignore. The on-close
      // handler will detach it from wsSet.
    }
  }
  return msg;
}

/**
 * Send a message direct to a single socket without buffering or seq-stamping.
 * Used for `replay_done` (carries its own `lastSeq` field, no envelope seq).
 *
 * The caller passes a fully formed WSMessage; this exists purely to centralize
 * the readyState gate + try/catch.
 */
export function sendDirect(ws: ServerWebSocket<WSData>, msg: WSMessage): void {
  if (ws.readyState !== WS_OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // see broadcastEvent
  }
}
