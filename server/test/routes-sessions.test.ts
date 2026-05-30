import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { getTableName } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionListItem } from 'shared/types';
import type { AuthVariables } from '../src/auth/middleware';
import type { DB } from '../src/db';
import type { AuditEvent } from '../src/lib/logger';
import { createSessionsRouter } from '../src/routes/sessions';
import { type ActiveSession, SessionManager } from '../src/services/session-manager';

// `routes-sessions.test.ts` covers the GET list shape + LIMIT and the entire
// DELETE close matrix (in-memory teardown, DB-only path, cross-user 404, audit
// emit).

// ─────────────────────────── Recording fake DB ───────────────────────────
//
// The shared `makeFakeDb` doesn't record orderBy/limit args, and we need to
// assert LIMIT 200 + filter shape on the GET list path. Roll a tiny purpose-
// built fake here.

interface SelectCall {
  table?: string;
  whereCalls: number;
  orderByCalls: number;
  limit: number | null;
}

interface UpdateCall {
  table?: string;
  set: unknown;
  /** Rows returned from the .returning() terminator, if it was called. */
  returned?: unknown[];
}

interface InsertCall {
  table?: string;
  values: unknown;
}

interface DeleteCall {
  table?: string;
  whereCalls: number;
}

interface RecordingDb {
  db: DB;
  selectCalls: SelectCall[];
  updateCalls: UpdateCall[];
  insertCalls: InsertCall[];
  deleteCalls: DeleteCall[];
  /** Rows returned by the next select chain to terminate. */
  selectQueue: unknown[][];
  /** Rows returned by the next `update().set().where().returning(...)` chain. */
  updateReturningQueue: unknown[][];
}

function makeRecordingDb(): RecordingDb {
  const selectCalls: SelectCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const insertCalls: InsertCall[] = [];
  const deleteCalls: DeleteCall[] = [];
  const selectQueue: unknown[][] = [];
  const updateReturningQueue: unknown[][] = [];

  const tableName = (t: unknown): string | undefined => {
    try {
      return getTableName(t as any);
    } catch {
      return undefined;
    }
  };

  const buildSelectChain = (call: SelectCall): unknown => {
    const chain: Record<string, unknown> = {};
    chain.where = () => {
      call.whereCalls += 1;
      return chain;
    };
    chain.orderBy = () => {
      call.orderByCalls += 1;
      return chain;
    };
    chain.limit = (n: number) => {
      call.limit = n;
      return Promise.resolve(selectQueue.shift() ?? []);
    };
    // biome-ignore lint/suspicious/noThenProperty: drizzle-shape thenable test fake.
    chain.then = (onF: (v: unknown[]) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(selectQueue.shift() ?? []).then(onF, onR);
    return chain;
  };

  const fake = {
    select: () => ({
      from: (t: unknown) => {
        const call: SelectCall = {
          table: tableName(t),
          whereCalls: 0,
          orderByCalls: 0,
          limit: null,
        };
        selectCalls.push(call);
        return buildSelectChain(call);
      },
    }),
    update: (t: unknown) => ({
      set: (values: unknown) => {
        const call: UpdateCall = { table: tableName(t), set: values };
        updateCalls.push(call);
        const whereChain: Record<string, unknown> = {};
        whereChain.returning = (_proj?: unknown) => {
          const rows = updateReturningQueue.shift() ?? [];
          call.returned = rows;
          return Promise.resolve(rows);
        };
        // biome-ignore lint/suspicious/noThenProperty: drizzle-shape thenable test fake.
        whereChain.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
          Promise.resolve().then(onF, onR);
        return { where: () => whereChain };
      },
    }),
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        insertCalls.push({ table: tableName(t), values: v });
        const ret = Promise.resolve();
        return Object.assign(ret, {
          returning: () => Promise.resolve([{ id: 'fake-1' }]),
          onConflictDoUpdate: () => Promise.resolve(),
        });
      },
    }),
    delete: (t: unknown) => {
      const call: DeleteCall = { table: tableName(t), whereCalls: 0 };
      deleteCalls.push(call);
      const whereChain: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: drizzle-shape thenable test fake.
        then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
          Promise.resolve().then(onF, onR),
      };
      return {
        where: () => {
          call.whereCalls += 1;
          return whereChain;
        },
      };
    },
  };

  return {
    db: fake as unknown as DB,
    selectCalls,
    updateCalls,
    insertCalls,
    deleteCalls,
    selectQueue,
    updateReturningQueue,
  };
}

// ─────────────────────────── App scaffolding ───────────────────────────

interface MockUser {
  id: string;
  email: string;
}

const DEFAULT_TEST_WORKSPACE_ROOT = '/tmp/kimi-webui-test';

function buildApp(opts: {
  user: MockUser;
  db: DB;
  manager: SessionManager;
  audit: AuditEvent[];
  env?: { WORKSPACE_ROOT: string };
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', opts.user as any);
    c.set('authSession', null);
    await next();
  });
  app.route(
    '/api/sessions',
    createSessionsRouter({
      db: opts.db,
      manager: opts.manager,
      auditLog: (e) => {
        opts.audit.push(e);
      },
      env: opts.env ?? { WORKSPACE_ROOT: DEFAULT_TEST_WORKSPACE_ROOT },
    }),
  );
  return app;
}

function registerActive(manager: SessionManager, sessionId: string, userId: string): ActiveSession {
  return manager.register({
    sessionId,
    userId,
    workDir: '/tmp/work',
  });
}

const ALICE_USER_ROOT = path.join(DEFAULT_TEST_WORKSPACE_ROOT, 'alice');

const aliceRow = (
  overrides: Partial<SessionListItem & { projectName: string }> = {},
): Record<string, unknown> => ({
  id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
  userId: 'alice',
  workDir: overrides.workDir ?? path.join(ALICE_USER_ROOT, 'work'),
  projectName: overrides.projectName ?? 'work',
  title: overrides.title ?? null,
  model: overrides.model ?? null,
  thinking: overrides.thinking ?? false,
  totalTokens: overrides.totalTokens ?? 0,
  totalCostUsd: overrides.totalCostUsd ?? 0,
  createdAt: new Date('2026-04-30T00:00:00Z'),
  lastActiveAt: new Date('2026-04-30T01:00:00Z'),
});

// ─────────────────────────── GET /api/sessions ───────────────────────────

describe('GET /api/sessions', () => {
  it('returns sessions as list, filtered by userId, with LIMIT 200', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([aliceRow({ id: 's1' }), aliceRow({ id: 's2' })]);
    const manager = new SessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions.map((s) => s.id)).toEqual(['s1', 's2']);

    // Recorded chain shape: select sessions + 1 where + 1 orderBy + LIMIT 200.
    expect(fake.selectCalls).toHaveLength(1);
    const sel = fake.selectCalls[0];
    expect(sel?.table).toBe('sessions');
    expect(sel?.whereCalls).toBe(1);
    expect(sel?.orderByCalls).toBe(1);
    expect(sel?.limit).toBe(200);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    const manager = new SessionManager();
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use('*', async (c, next) => {
      c.set('user', null);
      c.set('authSession', null);
      await next();
    });
    app.route(
      '/api/sessions',
      createSessionsRouter({
        db: fake.db,
        manager,
        auditLog: (e) => audit.push(e),
        env: { WORKSPACE_ROOT: DEFAULT_TEST_WORKSPACE_ROOT },
      }),
    );
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────── GET /api/sessions — origin + localWorkDir ─────

describe('GET /api/sessions — origin + localWorkDir', () => {
  it('marks rows whose workDir matches resolveWorkDir(env) as local', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    const localPath = path.join(ALICE_USER_ROOT, 'projA');
    fake.selectQueue.push([aliceRow({ id: 's-local', workDir: localPath, projectName: 'projA' })]);
    const manager = new SessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.projectName).toBe('projA');
    expect(body.sessions[0]?.origin).toBe('local');
    expect(body.sessions[0]?.localWorkDir).toBe(localPath);
    expect(body.sessions[0]?.workDir).toBe(localPath);
  });

  it('marks rows whose cached workDir differs from localWorkDir as foreign', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([
      aliceRow({ id: 's-foreign', workDir: '/legacy/office/path', projectName: 'projB' }),
    ]);
    const manager = new SessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.origin).toBe('foreign');
    expect(body.sessions[0]?.workDir).toBe('/legacy/office/path');
    expect(body.sessions[0]?.localWorkDir).toBe(path.join(ALICE_USER_ROOT, 'projB'));
  });

  it('returns all owned rows regardless of the cached workDir shape', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([
      aliceRow({
        id: 's-local',
        workDir: path.join(ALICE_USER_ROOT, 'projA'),
        projectName: 'projA',
      }),
      aliceRow({ id: 's-foreign', workDir: '/etc/something', projectName: 'projB' }),
      aliceRow({ id: 's-other-root', workDir: '/ws-other/alice/projC', projectName: 'projC' }),
    ]);
    const manager = new SessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions.map((s) => s.id)).toEqual(['s-local', 's-foreign', 's-other-root']);
    expect(body.sessions.map((s) => s.origin)).toEqual(['local', 'foreign', 'foreign']);
  });
});

// ─────────────────────────── DELETE /api/sessions/:id ───────────────────────────

describe('DELETE /api/sessions/:id', () => {
  it('DB-only path: deletes row + audit when session not in memory', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([{ workDir: '/tmp/work', sdkSessionId: 'sdk-X' }]);
    const manager = new SessionManager();

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-X', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(fake.deleteCalls).toHaveLength(1);
    expect(fake.deleteCalls[0]?.table).toBe('sessions');

    expect(audit).toContainEqual({
      userId: 'alice',
      action: 'session_delete',
      path: 'sess-X',
      bytes: 0,
      source: 'rest',
    });
  });

  it('in-memory path: tears the session down first, then deletes', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([{ workDir: '/tmp/work', sdkSessionId: null }]);
    const manager = new SessionManager();
    registerActive(manager, 'sess-A', 'alice');

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-A', { method: 'DELETE' });
    expect(res.status).toBe(200);

    // Teardown freed the in-memory slot (interrupt → drain → unregister).
    expect(manager.hasSession('sess-A')).toBe(false);
    // DB delete fired.
    expect(fake.deleteCalls).toHaveLength(1);

    // Teardown itself does not audit; only the delete is audited.
    const actions = audit.map((e) => e.action);
    expect(actions).toContain('session_delete');
  });

  it('returns 404 when row missing (select empty), no delete, no audit', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([]);
    const manager = new SessionManager();

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(fake.deleteCalls).toHaveLength(0);
    expect(audit).toEqual([]);
  });

  it('cross-user 404: alice cannot delete bob session, no teardown, no delete', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    // owner-scoped select filters out bob's row for alice → empty.
    fake.selectQueue.push([]);
    const manager = new SessionManager();
    registerActive(manager, 'sess-B', 'bob');

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-B', { method: 'DELETE' });
    expect(res.status).toBe(404);
    // Bob's session is untouched.
    expect(manager.hasSession('sess-B')).toBe(true);
    expect(fake.deleteCalls).toHaveLength(0);
    expect(audit).toEqual([]);
  });
});
