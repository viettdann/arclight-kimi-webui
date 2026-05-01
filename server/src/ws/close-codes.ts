import type { ServerWebSocket } from 'bun';
import { logger } from '../lib/logger';
import type { WSData } from './upgrade';

// Wire-contract close codes. Mirror the client's `ws-client.ts` checks.
//
// - 4401: session invalid (expired / revoked). Client must clear auth state,
//   redirect to /login, and NOT reconnect.
// - 4403: forbidden (reserved; not used in this milestone).
export const WS_CLOSE_AUTH_EXPIRED = 4401;
export const WS_CLOSE_AUTH_EXPIRED_REASON = 'session-expired';

/** Best-effort close with the auth-expired contract; logs but does not throw. */
export function closeAuthExpired(ws: ServerWebSocket<WSData>): void {
  try {
    ws.close(WS_CLOSE_AUTH_EXPIRED, WS_CLOSE_AUTH_EXPIRED_REASON);
  } catch (err) {
    logger.error({ err, authSessionId: ws.data.authSessionId }, 'closeAuthExpired: failed');
  }
}
