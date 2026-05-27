import type { WSMessage, WSMessageType } from 'shared/types';
import { wsClient } from './ws-client';

/**
 * Message types where a rapid duplicate frame creates a real side effect
 * (spawns a session, adopts a project). Double-clicks on the same control
 * fire these back-to-back, so we drop repeats within a short window.
 */
const GUARDED_TYPES: ReadonlySet<WSMessageType> = new Set([
  'create_session',
  'resume_session',
  'adopt_project',
]);

const GUARD_MS = 1500;
const lastSent = new Map<string, number>();

/** Identity of an action: same type + same target payload = same intent. */
function guardKey<T>(type: WSMessageType, payload: T, sessionId: string): string {
  return `${type}|${sessionId}|${JSON.stringify(payload ?? null)}`;
}

/**
 * Single entrypoint for client→server WS frames. Constructs the envelope,
 * stringifies, and forwards to the singleton client. `wsClient.send` drops
 * silently when the socket is not OPEN, which matches plan's no-op behavior
 * during reconnect.
 *
 * For {@link GUARDED_TYPES}, an identical frame sent within {@link GUARD_MS}
 * is dropped — this debounces accidental double-clicks on create/restore
 * controls that would otherwise spawn duplicate sessions.
 */
export function sendWS<T>(type: WSMessageType, payload: T, sessionId = ''): void {
  if (GUARDED_TYPES.has(type)) {
    const key = guardKey(type, payload, sessionId);
    const now = Date.now();
    if (now - (lastSent.get(key) ?? 0) < GUARD_MS) return;
    lastSent.set(key, now);
  }

  const msg: WSMessage<T> = {
    type,
    payload,
    sessionId,
    seq: 0,
    timestamp: Date.now(),
  };
  wsClient.send(JSON.stringify(msg));
}
