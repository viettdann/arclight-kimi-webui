import type { Server } from 'bun';
import { auth, slug } from '../auth';

export type WSData = {
  userId: string;
  /** `slug(email)` — matches user-root dir created by auth + routes/files. */
  userSlug: string;
  authSessionId: string;
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

  const data: WSData = {
    userId: session.user.id,
    userSlug: slug(session.user.email),
    authSessionId: session.session.id,
  };
  if (server.upgrade(req, { data })) return undefined;
  return new Response(null, { status: 426 });
}
