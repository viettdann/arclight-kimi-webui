import { rm } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionListItem, SessionListResponse } from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb, schema } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { projectTranscriptDir, transcriptPath } from '../services/agent/transcript-store';
import { teardownActiveSession } from '../services/session-lifecycle';
import { sessionManager as defaultManager, type SessionManager } from '../services/session-manager';

const SESSIONS_LIST_LIMIT = 200;

export interface SessionsRouterDeps {
  db: DB;
  manager: SessionManager;
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

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
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
        totalTokens: r.totalTokens,
        totalCostUsd: Number(r.totalCostUsd),
        projectName: r.projectName,
        createdAt: r.createdAt.toISOString(),
        lastActiveAt: r.lastActiveAt.toISOString(),
      });
    }

    const body: SessionListResponse = { sessions: items };
    return c.json(body);
  });

  // DELETE /:id — hard delete. If in memory, tear the session down first so the
  // SDK is shut down and any in-flight backup drains. Then remove the on-disk
  // transcript (best-effort) and DELETE the row. `session_transcripts` is
  // removed via ON DELETE CASCADE.
  sessions.delete('/:id', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');

    const [row] = await db
      .select({
        workDir: schema.sessions.workDir,
        sdkSessionId: schema.sessions.sdkSessionId,
      })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)))
      .limit(1);
    if (!row) {
      return c.json({ error: 'not_found' }, 404);
    }

    const active = manager.getForUser(user.id, id);
    if (active != null) {
      await teardownActiveSession(active, { manager, db });
    }

    if (row.sdkSessionId) {
      // Remove this session's on-disk transcript: the `<sdkSessionId>.jsonl`
      // file and the `<sdkSessionId>/` subtree (subagent transcripts). Both sit
      // under the shared per-cwd project dir, so sibling sessions are untouched.
      const jsonl = transcriptPath(row.workDir, row.sdkSessionId);
      const subtree = path.join(projectTranscriptDir(row.workDir), row.sdkSessionId);
      try {
        await rm(jsonl, { force: true });
        await rm(subtree, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ err, sessionId: id, jsonl }, 'failed to remove session transcript');
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
