import { rm } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionListItem, SessionListResponse, SessionStatus } from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb, schema } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { kimiPaths } from '../services/kimi-config/paths';
import { closeActiveSession } from '../services/session-lifecycle';
import {
  sessionManager as defaultManager,
  type KimiSessionManager,
} from '../services/session-manager';

const VALID_STATUSES: ReadonlySet<SessionStatus> = new Set(['active', 'idle', 'closed']);
const SESSIONS_LIST_LIMIT = 200;

function isStatus(v: string | undefined): v is SessionStatus {
  return v != null && VALID_STATUSES.has(v as SessionStatus);
}

export interface SessionsRouterDeps {
  db: DB;
  manager: KimiSessionManager;
  auditLog: typeof defaultAuditLog;
  env: Pick<Env, 'WORKSPACE_ROOT'>;
}

/**
 * Factory: build the `/api/sessions` router with injected deps. Tests build a
 * fresh router per case with stub `db`/`manager`/`auditLog`. Production wiring
 * uses the default singletons via the `default` export at the bottom.
 *
 * Endpoints:
 *   GET  /            list sessions for current user (LIMIT 200, sorted desc)
 *   POST /:id/close   teardown session (in-memory or DB-only); idempotent
 *   DELETE /:id       teardown if needed, remove disk dir, DELETE row
 *
 * Cross-user / unknown ids return 404 to avoid leaking existence.
 */
export function createSessionsRouter(deps: SessionsRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db, manager, auditLog, env } = deps;

  const sessions = new Hono<{ Variables: AuthVariables }>();
  // Caller mounts `sessionMiddleware` at the app level (see index.ts) so the
  // user is already populated by the time we reach `requireAuth`. Routes
  // tested in isolation can stub the user via their own outer middleware
  // without colliding with BetterAuth.
  sessions.use('*', requireAuth);

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
      .orderBy(desc(schema.sessions.lastActiveAt))
      .limit(SESSIONS_LIST_LIMIT);

    // Hoist user root out of the row loop: slug(email) and the WORKSPACE_ROOT
    // join only depend on the current user, so they're constant across every
    // row of this response. Saves ~200 redundant slug() passes per listing.
    const userRoot = path.join(env.WORKSPACE_ROOT, slug(user.email ?? ''));

    const items: SessionListItem[] = [];
    for (const r of rows) {
      const localWorkDir = path.join(userRoot, r.projectName);
      items.push({
        id: r.id,
        workDir: r.workDir,
        localWorkDir,
        origin: r.workDir === localWorkDir ? 'local' : 'foreign',
        title: r.title,
        model: r.model,
        thinking: r.thinking,
        status: (VALID_STATUSES.has(r.status as SessionStatus)
          ? r.status
          : 'closed') as SessionStatus,
        totalTokens: r.totalTokens,
        projectName: r.projectName,
        createdAt: r.createdAt.toISOString(),
        lastActiveAt: r.lastActiveAt.toISOString(),
      });
    }

    const body: SessionListResponse = { sessions: items };
    return c.json(body);
  });

  // POST /:id/close — single source of truth is `closeActiveSession`. If the
  // session is in memory, the helper does the full teardown (interrupt → drain
  // backup → SDK close → DB closed → broadcast → audit → unregister). Otherwise
  // a single owner-scoped UPDATE...RETURNING handles both 200-idempotent and
  // 404-miss without leaking existence: empty `returning` ⇒ row absent or
  // owned by another user, both surfaced as 404.
  sessions.post('/:id/close', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');

    const active = manager.getForUser(user.id, id);
    if (active != null) {
      await closeActiveSession(active, { manager, db, auditLog }, { reason: 'rest' });
      return c.json({ ok: true });
    }

    // DB-only path: one round-trip. Re-running on an already-closed row still
    // matches the WHERE clause and returns the id, so idempotent calls return
    // 200 without requiring an explicit `status != 'closed'` short-circuit.
    const updated = await db
      .update(schema.sessions)
      .set({ status: 'closed' })
      .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)))
      .returning({ id: schema.sessions.id });

    if (updated.length === 0) {
      return c.json({ error: 'not_found' }, 404);
    }

    auditLog({
      userId: user.id,
      action: 'session_close',
      path: id,
      bytes: 0,
      source: 'rest',
    });

    return c.json({ ok: true });
  });

  // DELETE /:id — hard delete. If in memory, run the full close teardown first
  // so the SDK is shut down and any in-flight backup drains. Then remove the
  // Kimi session dir on disk (best-effort) and DELETE the row. `session_files`
  // is removed via ON DELETE CASCADE.
  sessions.delete('/:id', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');

    const [row] = await db
      .select({ workDir: schema.sessions.workDir, kimiSessionId: schema.sessions.kimiSessionId })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)))
      .limit(1);
    if (!row) {
      return c.json({ error: 'not_found' }, 404);
    }

    const active = manager.getForUser(user.id, id);
    if (active != null) {
      await closeActiveSession(active, { manager, db, auditLog }, { reason: 'rest' });
    }

    if (row.kimiSessionId) {
      const sessionDir = kimiPaths().sessionDir(row.workDir, row.kimiSessionId);
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ err, sessionId: id, sessionDir }, 'failed to remove kimi session dir');
      }
    }

    await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)));

    auditLog({
      userId: user.id,
      action: 'session_delete',
      path: id,
      bytes: 0,
      source: 'rest',
    });

    return c.json({ ok: true });
  });

  return sessions;
}

// Default export wires production singletons. Tests build their own router via
// `createSessionsRouter({ ... })`.
export default createSessionsRouter({
  db: defaultDb,
  manager: defaultManager,
  auditLog: defaultAuditLog,
  env: defaultEnv,
});
