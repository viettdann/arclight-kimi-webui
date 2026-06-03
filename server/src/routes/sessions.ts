import path from 'node:path';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionListItem, SessionListResponse } from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb, schema } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { isUnderWorkspace } from '../services/agent/agent-paths';
import { deleteStoreEntries } from '../services/agent/session-store';
import { clearLocalSession, firstUserTextFromJsonl } from '../services/agent/transcript-store';
import { teardownActiveSession } from '../services/session-lifecycle';
import { sessionManager as defaultManager, type SessionManager } from '../services/session-manager';

const SESSIONS_LIST_LIMIT = 200;

/** First N user-type main entries scanned to derive the provisional title. The
 *  opening prompt is the first user entry; a small cap absorbs any leading
 *  tool_result-only user turns while keeping the per-row subquery cheap. */
const TITLE_HEAD_USER_ENTRIES = 5;

/** Max length of the provisional title shipped to the client. */
const PROVISIONAL_TITLE_MAX = 120;

/**
 * Derive a provisional title from a transcript head: the first real user
 * prompt, whitespace-collapsed to one line and length-capped. Null when the
 * head holds no user text yet. Never persisted — purely a display fallback.
 */
function provisionalTitle(head: string | null | undefined): string | null {
  if (!head) return null;
  const text = firstUserTextFromJsonl(head);
  if (!text) return null;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > PROVISIONAL_TITLE_MAX ? oneLine.slice(0, PROVISIONAL_TITLE_MAX) : oneLine;
}

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

    // Join the transcript head (not the full content — sessions can be 100KB+)
    // so the provisional title can be derived without a second query per row.
    const rows = await db
      .select({
        ...getTableColumns(schema.sessions),
        // Provisional-title head: the session's first few *user* main entries
        // (by SDK id) reconstructed as JSONL — only `type='user'` non-meta rows,
        // since the title is the opening user prompt. Filtering in SQL avoids
        // shipping assistant/tool entries. A correlated subquery keeps the
        // listing a single round-trip; the load index covers sdk_session_id.
        transcriptHead: sql<string | null>`(
          SELECT string_agg(sub.entry::text, E'\n' ORDER BY sub.id)
          FROM (
            SELECT id, entry FROM session_store_entries
            WHERE sdk_session_id = ${schema.sessions.sdkSessionId}
              AND subpath IS NULL
              AND entry->>'type' = 'user'
              AND COALESCE(entry->>'isMeta', '') <> 'true'
            ORDER BY id LIMIT ${TITLE_HEAD_USER_ENTRIES}
          ) sub
        )`,
      })
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
        firstUserText: provisionalTitle(r.transcriptHead),
        model: r.model,
        providerId: r.providerId,
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
  // SDK is shut down. Then remove the session's mirrored store entries + on-disk
  // scratch (best-effort) and DELETE the row.
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
      // Remove the session's mirrored transcript from the DB store (the cleanup
      // the old session_transcripts FK cascade used to do; store rows are generic).
      try {
        await deleteStoreEntries(db, [row.sdkSessionId]);
      } catch (err) {
        logger.warn({ err, sessionId: id }, 'failed to remove session store entries');
      }
      // Remove on-disk scratch: `<sdkSessionId>.jsonl` + the `<sdkSessionId>/`
      // subtree (subagent transcripts), siblings untouched. Foreign/remote
      // workDirs outside the workspace never had a local dir.
      if (isUnderWorkspace(row.workDir)) {
        await clearLocalSession(row.workDir, row.sdkSessionId);
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
