import type { Server } from 'bun';
import { auth, slug } from '../auth';
import { canUserAccess } from '../auth/access';
import { db } from '../db';

export type WSData = {
  userId: string;
  /** `slug(email)` — matches user-root dir created by auth + routes/files. */
  userSlug: string;
  authSessionId: string;
  /** Epoch ms of the last successful auth-session revalidation for this socket. */
  lastValidatedAt: number;
};

/**
 * Resolve auth from request headers and upgrade to WebSocket.
 * Returns Response on auth failure, undefined when upgrade succeeded,
 * or a 426 Response when upgrade failed for other reasons.
 */
export async function handleWsUpgrade(
  req: Request,
  server: Server<WSData>,
): Promise<Response | undefined> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return new Response(null, { status: 401 });

  // Allowlist gate at upgrade time. A pending user is rejected here. The
  // browser never sees this 403 — a failed WS handshake surfaces only as an
  // abnormal close (1006) — so the reconnect-loop is prevented purely by the
  // client `canConnect` gate, which refuses to connect unless `allowed`.
  if (!(await canUserAccess(db, session.user))) return new Response(null, { status: 403 });

  const data: WSData = {
    userId: session.user.id,
    userSlug: slug(session.user.email),
    authSessionId: session.session.id,
    lastValidatedAt: Date.now(),
  };
  // Registry insertion happens in `websocket.open` (index.ts) where Bun
  // hands us the live `ws` reference; `server.upgrade` only returns a bool.
  if (server.upgrade(req, { data })) return undefined;
  return new Response(null, { status: 426 });
}
