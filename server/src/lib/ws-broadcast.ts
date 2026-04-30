import type { ServerWebSocket } from 'bun';
import type { WSMessage } from 'shared/types';

// Broadcast a WS message to every socket attached to a session. Full
// implementation in MVP-5 alongside SessionManager.

export function broadcast(_sockets: Set<ServerWebSocket<unknown>>, _msg: WSMessage): void {
  throw new Error('broadcast not implemented (MVP-5)');
}
