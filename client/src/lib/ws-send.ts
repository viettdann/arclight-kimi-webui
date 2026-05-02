import type { WSMessage, WSMessageType } from 'shared/types';
import { wsClient } from './ws-client';

/**
 * Single entrypoint for client→server WS frames. Constructs the envelope,
 * stringifies, and forwards to the singleton client. `wsClient.send` drops
 * silently when the socket is not OPEN, which matches plan's no-op behavior
 * during reconnect.
 */
export function sendWS<T>(type: WSMessageType, payload: T, sessionId = ''): void {
  const msg: WSMessage<T> = {
    type,
    payload,
    sessionId,
    seq: 0,
    timestamp: Date.now(),
  };
  wsClient.send(JSON.stringify(msg));
}
