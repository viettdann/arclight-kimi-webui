import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import path from 'node:path';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import { getTableName } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionListItem, WSMessage } from 'shared/types';
import type { AuthVariables } from '../src/auth/middleware';
import type { DB } from '../src/db';
import type { AuditEvent } from '../src/lib/logger';
import { createSessionsRouter } from '../src/routes/sessions';
import { type ActiveSession, KimiSessionManager } from '../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../src/ws/handlers';
import { asWS, FakeWS, stubSession } from './_helpers';

// `routes-sessions.test.ts` covers the GET list shape + LIMIT and the entire
// POST close matrix (in-memory teardown, DB-only path, idempotent, cross-user
// 404, REST + WS race, audit emit). The WS-side close test sits here too so
// the audit/source assertions stay co-located with the REST close.

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
      // biome-ignore lint/suspicious/noExplicitAny: drizzle's PgTable type guard is structural
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

// ─────────────────────────── Stub Kimi session ───────────────────────────

interface StubKimi {
  closeCalls: number;
  asSession: Session;
}

/**
 * Wraps `_helpers.ts:stubSession` and overrides `close` to count invocations.
 * Used to assert the close-once invariant across REST/WS race tests.
 */
function makeStubKimi(): StubKimi {
  const stub: StubKimi = { closeCalls: 0, asSession: stubSession() };
  (stub.asSession as unknown as { close: () => Promise<void> }).close = async () => {
    stub.closeCalls += 1;
  };
  return stub;
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
  manager: KimiSessionManager;
  audit: AuditEvent[];
  env?: { WORKSPACE_ROOT: string };
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: test fixture forces user shape
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

function registerActive(
  manager: KimiSessionManager,
  sessionId: string,
  userId: string,
  kimiSession: Session,
): ActiveSession {
  return manager.register({
    sessionId,
    userId,
    workDir: '/tmp/work',
    kimiSessionId: `kimi-${sessionId}`,
    kimiSession,
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
  status: overrides.status ?? 'active',
  kimiSessionId: 'kimi-alice-1',
  totalTokens: overrides.totalTokens ?? 0,
  createdAt: new Date('2026-04-30T00:00:00Z'),
  lastActiveAt: new Date('2026-04-30T01:00:00Z'),
});

// ─────────────────────────── GET /api/sessions ───────────────────────────

describe('GET /api/sessions', () => {
  it('returns sessions as list, filtered by userId, with LIMIT 200', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([aliceRow({ id: 's1' }), aliceRow({ id: 's2' })]);
    const manager = new KimiSessionManager();
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

    // Recorded chain shape: select kimi_sessions + 1 where + 1 orderBy + LIMIT 200.
    expect(fake.selectCalls).toHaveLength(1);
    const sel = fake.selectCalls[0];
    expect(sel?.table).toBe('kimi_sessions');
    expect(sel?.whereCalls).toBe(1);
    expect(sel?.orderByCalls).toBe(1);
    expect(sel?.limit).toBe(200);
  });

  it('honours ?status= filter (status=closed adds the second condition)', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([aliceRow({ id: 's-closed', status: 'closed' })]);
    const manager = new KimiSessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions?status=closed');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionListItem[] };
    expect(body.sessions[0]?.status).toBe('closed');
    // The status filter still uses the chain shape; we don't introspect the
    // composite where here — only the limit cap is asserted in the basic test.
    expect(fake.selectCalls[0]?.limit).toBe(200);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    const manager = new KimiSessionManager();
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
    const manager = new KimiSessionManager();
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
    const manager = new KimiSessionManager();
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
    const manager = new KimiSessionManager();
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

// ─────────────────────────── POST /api/sessions/:id/close ───────────────────────────

describe('POST /api/sessions/:id/close — in-memory path', () => {
  it('runs full teardown via closeActiveSession: SDK close, DB closed, broadcast, unregister, audit', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    const manager = new KimiSessionManager();
    const stub = makeStubKimi();
    const active = registerActive(manager, 'sess-A', 'alice', stub.asSession);

    // Attach a fake socket so we can confirm `session_state{closed}` reached it
    // and that the helper did NOT close the socket.
    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-A/close', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // SDK close called exactly once.
    expect(stub.closeCalls).toBe(1);

    // DB durable update happened on the kimi_sessions table.
    expect(
      fake.updateCalls.some(
        (u) =>
          u.table === 'kimi_sessions' && (u.set as Record<string, unknown>).status === 'closed',
      ),
    ).toBe(true);

    // Broadcast hit the socket with session_state{closed, reason:'rest'}.
    const msgs = ws.parsed();
    const stateMsg = msgs.find((m) => m.type === 'session_state') as
      | WSMessage<{ state: string; reason?: string }>
      | undefined;
    expect(stateMsg?.payload).toEqual({ state: 'closed', reason: 'rest' });

    // Helper does NOT close attached sockets.
    expect(ws.closeCalls).toEqual([]);
    expect(ws.readyState).toBe(1);

    // Manager freed the slot.
    expect(manager.hasSession('sess-A')).toBe(false);

    // Audit emitted with action=session_close, source=rest.
    expect(audit).toContainEqual({
      userId: 'alice',
      action: 'session_close',
      path: 'sess-A',
      bytes: 0,
      source: 'rest',
    });
  });

  it('cross-user 404: alice cannot close bob session, no leak, no teardown', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    // DB-only fallback: WHERE id+userId yields no row for alice → empty
    // returning array → 404.
    fake.updateReturningQueue.push([]);
    const manager = new KimiSessionManager();
    const stub = makeStubKimi();
    registerActive(manager, 'sess-B', 'bob', stub.asSession);

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-B/close', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(stub.closeCalls).toBe(0);
    expect(manager.hasSession('sess-B')).toBe(true);
    expect(audit).toEqual([]);
  });

  it('idempotent: second call after teardown still returns 200', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    const manager = new KimiSessionManager();
    const stub = makeStubKimi();
    registerActive(manager, 'sess-A', 'alice', stub.asSession);

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    // 1st call → in-memory teardown.
    const r1 = await app.request('/api/sessions/sess-A/close', { method: 'POST' });
    expect(r1.status).toBe(200);
    expect(stub.closeCalls).toBe(1);

    // 2nd call: not in memory anymore → DB-only UPDATE...RETURNING. The row
    // still matches the WHERE clause (same id+userId) so returning yields one
    // id → 200 idempotent. The status no-op is harmless.
    fake.updateReturningQueue.push([{ id: 'sess-A' }]);
    const r2 = await app.request('/api/sessions/sess-A/close', { method: 'POST' });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: true });

    // SDK close not called twice.
    expect(stub.closeCalls).toBe(1);
    // Two audits total (one per call).
    expect(audit.filter((e) => e.action === 'session_close')).toHaveLength(2);
  });
});

describe('POST /api/sessions/:id/close — DB-only path', () => {
  it('returns 200 + audit when row exists and is not in memory', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.updateReturningQueue.push([{ id: 'sess-X' }]);
    const manager = new KimiSessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-X/close', { method: 'POST' });
    expect(res.status).toBe(200);

    // Single round-trip: one UPDATE on kimi_sessions setting status='closed'.
    expect(fake.updateCalls).toHaveLength(1);
    const upd = fake.updateCalls[0];
    expect(upd?.table).toBe('kimi_sessions');
    expect((upd?.set as Record<string, unknown>).status).toBe('closed');
    expect(upd?.returned).toEqual([{ id: 'sess-X' }]);

    expect(audit).toContainEqual({
      userId: 'alice',
      action: 'session_close',
      path: 'sess-X',
      bytes: 0,
      source: 'rest',
    });
  });

  it('returns 404 when row is missing (UPDATE returns empty, no audit)', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.updateReturningQueue.push([]);
    const manager = new KimiSessionManager();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/missing/close', { method: 'POST' });
    expect(res.status).toBe(404);
    // Update was attempted but returned empty — no audit emitted.
    expect(audit).toEqual([]);
  });
});

// ─────────────────────────── WS close_session ───────────────────────────

describe('WS close_session handler', () => {
  let manager: KimiSessionManager;
  let audit: AuditEvent[];

  beforeEach(() => {
    manager = new KimiSessionManager();
    audit = [];
    const fake = makeRecordingDb();
    setHandlerDeps({
      manager,
      db: fake.db,
      auditLog: (e) => audit.push(e),
    });
  });

  afterEach(() => {
    setHandlerDeps(null);
  });

  it('emits session_state{closed, reason:"ws"} and keeps the socket open', async () => {
    const stub = makeStubKimi();
    const active = registerActive(manager, 'sess-A', 'alice', stub.asSession);
    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(asWS(ws), JSON.stringify({ type: 'close_session', sessionId: 'sess-A' }));

    const stateMsg = ws.parsed().find((m) => m.type === 'session_state') as
      | WSMessage<{ state: string; reason?: string }>
      | undefined;
    expect(stateMsg?.payload).toEqual({ state: 'closed', reason: 'ws' });

    // Socket NOT closed by handler — clients may share the socket across many
    // sessions, so closing it would kill the others.
    expect(ws.closeCalls).toEqual([]);
    expect(ws.readyState).toBe(1);

    expect(stub.closeCalls).toBe(1);
    expect(manager.hasSession('sess-A')).toBe(false);

    expect(audit).toContainEqual({
      userId: 'alice',
      action: 'session_close',
      path: 'sess-A',
      bytes: 0,
      source: 'ws',
    });
  });

  it('REST close + WS close race → exactly one teardown, kimiSession.close called once', async () => {
    const stub = makeStubKimi();
    const active = registerActive(manager, 'sess-A', 'alice', stub.asSession);

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    // Build a REST app that shares the same manager + audit sink.
    const fakeRest = makeRecordingDb();
    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fakeRest.db,
      manager,
      audit,
    });

    // Race: fire REST close and WS close concurrently. The first to reach
    // `manager.hasSession` wins; the other exits silently via the helper guard.
    await Promise.all([
      app.request('/api/sessions/sess-A/close', { method: 'POST' }),
      handleMessage(asWS(ws), JSON.stringify({ type: 'close_session', sessionId: 'sess-A' })),
    ]);

    // SDK close called exactly once across both racing paths.
    expect(stub.closeCalls).toBe(1);
    expect(manager.hasSession('sess-A')).toBe(false);

    // Exactly one session_close audit entry on the winning path. The losing
    // path bails before audit.
    const closeAudits = audit.filter((e) => e.action === 'session_close');
    expect(closeAudits).toHaveLength(1);
  });
});

// ─────────────────────────── DELETE /api/sessions/:id ───────────────────────────

describe('DELETE /api/sessions/:id', () => {
  it('DB-only path: deletes row + audit when session not in memory', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([{ workDir: '/tmp/work', kimiSessionId: 'kimi-sess-X' }]);
    const manager = new KimiSessionManager();

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
    expect(fake.deleteCalls[0]?.table).toBe('kimi_sessions');

    expect(audit).toContainEqual({
      userId: 'alice',
      action: 'session_delete',
      path: 'sess-X',
      bytes: 0,
      source: 'rest',
    });
    // No close audit on DB-only path — session wasn't in memory.
    expect(audit.some((e) => e.action === 'session_close')).toBe(false);
  });

  it('in-memory path: closes session first, then deletes; 2 audits', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([{ workDir: '/tmp/work', kimiSessionId: 'kimi-sess-A' }]);
    const manager = new KimiSessionManager();
    const stub = makeStubKimi();
    registerActive(manager, 'sess-A', 'alice', stub.asSession);

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-A', { method: 'DELETE' });
    expect(res.status).toBe(200);

    // SDK was closed exactly once (via closeActiveSession).
    expect(stub.closeCalls).toBe(1);
    // Manager freed the slot.
    expect(manager.hasSession('sess-A')).toBe(false);
    // DB delete fired.
    expect(fake.deleteCalls).toHaveLength(1);

    // Audit: close + delete, in that order.
    const actions = audit.map((e) => e.action);
    expect(actions).toContain('session_close');
    expect(actions).toContain('session_delete');
  });

  it('returns 404 when row missing (select empty), no delete, no audit', async () => {
    const audit: AuditEvent[] = [];
    const fake = makeRecordingDb();
    fake.selectQueue.push([]);
    const manager = new KimiSessionManager();

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
    const manager = new KimiSessionManager();
    const stub = makeStubKimi();
    registerActive(manager, 'sess-B', 'bob', stub.asSession);

    const app = buildApp({
      user: { id: 'alice', email: 'alice@example.com' },
      db: fake.db,
      manager,
      audit,
    });

    const res = await app.request('/api/sessions/sess-B', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(stub.closeCalls).toBe(0);
    expect(manager.hasSession('sess-B')).toBe(true);
    expect(fake.deleteCalls).toHaveLength(0);
    expect(audit).toEqual([]);
  });
});
