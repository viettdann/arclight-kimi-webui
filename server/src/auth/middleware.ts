import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { canUserAccess } from './access';
import { type AuthSession, type AuthUser, auth } from './index';

export type AuthVariables = {
  user: AuthUser | null;
  authSession: AuthSession | null;
};

export const sessionMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', session?.user ?? null);
  c.set('authSession', session?.session ?? null);
  return next();
});

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (c.var.user == null) return c.json({ error: 'unauthorized' }, 401);
  return next();
});

export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  if ((user as AuthUser & { role?: string }).role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
});

// Allowlist gate. Self-sufficient: runs ahead of a router's own `requireAuth`,
// so it rejects an absent session itself rather than assuming auth ran first.
// A 403 here (not 401) keeps a pending-but-authenticated user on Coming Soon
// instead of bouncing them to the login modal.
export const requireAllowed = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  if (!(await canUserAccess(db, user as AuthUser & { role?: string }))) {
    return c.json({ error: 'not_allowed' }, 403);
  }
  return next();
});
