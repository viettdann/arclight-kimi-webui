import { createMiddleware } from 'hono/factory';
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
