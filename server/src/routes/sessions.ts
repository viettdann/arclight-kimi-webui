import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionListItem, SessionListResponse, SessionStatus } from 'shared/types';
import { type AuthVariables, requireAuth, sessionMiddleware } from '../auth/middleware';
import { db, schema } from '../db';

const sessions = new Hono<{ Variables: AuthVariables }>();

sessions.use('*', sessionMiddleware);
sessions.use('*', requireAuth);

const VALID_STATUSES: ReadonlySet<SessionStatus> = new Set(['active', 'idle', 'closed']);

function isStatus(v: string | undefined): v is SessionStatus {
  return v != null && VALID_STATUSES.has(v as SessionStatus);
}

sessions.get('/', async (c) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);

  const statusQ = c.req.query('status');
  const conditions = [eq(schema.sessions.userId, user.id)];
  if (isStatus(statusQ)) {
    conditions.push(eq(schema.sessions.status, statusQ));
  }

  const rows = await db
    .select()
    .from(schema.sessions)
    .where(and(...conditions))
    .orderBy(desc(schema.sessions.lastActiveAt));

  const items: SessionListItem[] = rows.map((r) => ({
    id: r.id,
    workDir: r.workDir,
    title: r.title,
    model: r.model,
    thinking: r.thinking,
    status: (VALID_STATUSES.has(r.status as SessionStatus) ? r.status : 'closed') as SessionStatus,
    totalTokens: r.totalTokens,
    createdAt: r.createdAt.toISOString(),
    lastActiveAt: r.lastActiveAt.toISOString(),
  }));

  const body: SessionListResponse = { sessions: items };
  return c.json(body);
});

// MVP-5 note: the WS `close_session` handler is responsible for tearing down
// the in-memory `KimiSessionManager` entry and closing connected sockets. This
// REST endpoint only marks the DB row closed; it must remain decoupled from
// the WS layer so REST routes don't import sessionManager.
sessions.post('/:id/close', async (c) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');

  const updated = await db
    .update(schema.sessions)
    .set({ status: 'closed' })
    .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)))
    .returning({ id: schema.sessions.id });

  if (updated.length === 0) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

export default sessions;
