import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ActiveSession } from '../../src/services/session-manager';
import { SessionManager } from '../../src/services/session-manager';
import { buildSnapshot, emptySnapshot } from '../../src/services/snapshot';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, wsErrors } from '../_helpers';

// `ultracode` (xhigh + workflow orchestration) rides along with send_message
// exactly like thinking/effort: a changed value updates the in-memory session,
// is pushed to the live query via applyFlagSettings({ ultracode }), and is
// persisted to the sessions row. stop_task forwards a taskId to query.stopTask.
// A live query is pre-attached so ensureQuery is a no-op (no subprocess spawn).

interface FlagCall {
  ultracode?: boolean;
  alwaysThinkingEnabled?: boolean | null;
  effortLevel?: string | null;
}

function attachLiveQuery(active: ActiveSession): {
  flagCalls: FlagCall[];
  pushed: string[];
  stopCalls: string[];
} {
  const flagCalls: FlagCall[] = [];
  const pushed: string[] = [];
  const stopCalls: string[] = [];
  active.query = {
    applyFlagSettings: async (settings: FlagCall) => {
      flagCalls.push(settings);
    },
    stopTask: async (taskId: string) => {
      stopCalls.push(taskId);
    },
  } as unknown as ActiveSession['query'];
  active.bridge = {
    push: (text: string) => pushed.push(text),
  } as unknown as ActiveSession['bridge'];
  return { flagCalls, pushed, stopCalls };
}

let manager: SessionManager;

beforeEach(() => {
  manager = new SessionManager();
});

afterEach(() => {
  setHandlerDeps(null);
});

async function send(ws: FakeWS, payload: object): Promise<void> {
  await handleMessage(
    asWS(ws),
    JSON.stringify({ type: 'send_message', sessionId: 'sess-1', payload }),
  );
}

describe('handleSendMessage — ultracode ride-along', () => {
  it('applies a changed ultracode: in-memory + live query + persisted row', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      ultracode: false,
    });
    const { flagCalls, pushed } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', ultracode: true });

    // In-memory updated.
    expect(active.ultracode).toBe(true);
    // Live query received the flag in { ultracode } shape, followed by the
    // non-destructive override (force thinking on + clear our effort).
    expect(flagCalls).toEqual([
      { ultracode: true },
      { alwaysThinkingEnabled: null, effortLevel: null },
    ]);
    // Persisted to the sessions row.
    const update = fake.calls.find((c) => c.op === 'update');
    expect((update?.values as { ultracode?: boolean }).ultracode).toBe(true);
    // The turn still proceeds: the prompt is pushed to the bridge.
    expect(pushed).toEqual(['hi']);
    expect(wsErrors(alice)).toHaveLength(0);
  });

  it('leaves ultracode unchanged when omitted (no flag call, no persist)', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      ultracode: true,
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi' });

    expect(active.ultracode).toBe(true);
    expect(flagCalls).toEqual([]);
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('is a no-op when the supplied ultracode equals the current value', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      ultracode: true,
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', ultracode: true });

    expect(flagCalls).toEqual([]);
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('rejects a non-boolean ultracode with bad_request', async () => {
    manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      ultracode: false,
    });
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', ultracode: 'yes' });

    expect(wsErrors(alice).at(-1)?.payload.code).toBe('bad_request');
  });
});

describe('handleSendMessage — ultracode runtime override', () => {
  it('toggle ON applies the override (thinking on + effort cleared) without mutating stored flags', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      thinking: false,
      effort: 'low',
      ultracode: false,
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    await send(new FakeWS('alice'), { content: 'hi', ultracode: true });

    expect(active.ultracode).toBe(true);
    // Stored thinking/effort are NOT mutated — the override is runtime-only.
    expect(active.thinking).toBe(false);
    expect(active.effort).toBe('low');
    // ultracode applied first, then the override.
    expect(flagCalls).toEqual([
      { ultracode: true },
      { alwaysThinkingEnabled: null, effortLevel: null },
    ]);
    // Only the ultracode column is persisted (not thinking/effort).
    const update = fake.calls.find((c) => c.op === 'update');
    expect(update?.values).toEqual({ ultracode: true });
  });

  it('toggle OFF re-applies the stored thinking/effort to the live query', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      thinking: false,
      effort: 'medium',
      ultracode: true,
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    await send(new FakeWS('alice'), { content: 'hi', ultracode: false });

    expect(active.ultracode).toBe(false);
    // Reverting restores the stored flags onto the live query.
    expect(flagCalls).toEqual([
      { ultracode: false },
      { alwaysThinkingEnabled: false, effortLevel: 'medium' },
    ]);
    const update = fake.calls.find((c) => c.op === 'update');
    expect(update?.values).toEqual({ ultracode: false });
  });

  it('toggle OFF with stored thinking on re-applies alwaysThinkingEnabled: null', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      thinking: true,
      effort: null,
      ultracode: true,
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    await send(new FakeWS('alice'), { content: 'hi', ultracode: false });

    expect(flagCalls).toEqual([
      { ultracode: false },
      { alwaysThinkingEnabled: null, effortLevel: null },
    ]);
  });

  it('drops thinking/effort flag changes while ultracode is on (live query + DB untouched)', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      thinking: false,
      effort: 'low',
      ultracode: true,
    });
    const { flagCalls, pushed } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', thinking: true, effort: 'high' });

    // Stored flags untouched; ultracode stays on.
    expect(active.thinking).toBe(false);
    expect(active.effort).toBe('low');
    expect(active.ultracode).toBe(true);
    // No flag pushed to the live query, no DB write.
    expect(flagCalls).toEqual([]);
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
    // The turn still proceeds.
    expect(pushed).toEqual(['hi']);
    expect(wsErrors(alice)).toHaveLength(0);
  });
});

describe('handleStopTask', () => {
  async function stopTask(ws: FakeWS, payload: unknown): Promise<void> {
    await handleMessage(
      asWS(ws),
      JSON.stringify({ type: 'stop_task', sessionId: 'sess-1', payload }),
    );
  }

  it('forwards the taskId to query.stopTask', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
    });
    const { stopCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await stopTask(alice, { taskId: 'task-xyz' });

    expect(stopCalls).toEqual(['task-xyz']);
    expect(wsErrors(alice)).toHaveLength(0);
  });

  it('rejects a missing/empty taskId with bad_request and never calls stopTask', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
    });
    const { stopCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await stopTask(alice, { taskId: '' });

    expect(wsErrors(alice).at(-1)?.payload.code).toBe('bad_request');
    expect(stopCalls).toEqual([]);
  });

  it('replies not_found when the session is not in memory', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await stopTask(alice, { taskId: 'task-xyz' });

    expect(wsErrors(alice).at(-1)?.payload.code).toBe('not_found');
  });

  it('is a no-op (no error) when the session has no live query', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
    });
    manager.attachWS(active, asWS(new FakeWS('alice')));
    // No query attached → active.query is null; stopTask is a best-effort no-op.

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await stopTask(alice, { taskId: 'task-xyz' });

    expect(wsErrors(alice)).toHaveLength(0);
  });
});

describe('handleStartSession — ultracode insert', () => {
  let userSlug: string;
  let workspaceRoot: string;
  let validWorkDir: string;

  beforeEach(async () => {
    // Must match the env stub's WORKSPACE_ROOT (server/test/setup.ts) — the
    // workDir validation gate rejects anything outside `${WORKSPACE_ROOT}/<slug>`.
    workspaceRoot = '/tmp/mtc-webui-test';
    await mkdir(workspaceRoot, { recursive: true });
    const dir = await mkdtemp(path.join(workspaceRoot, 'ultracode-'));
    userSlug = path.basename(dir);
    validWorkDir = path.join(workspaceRoot, userSlug, 'demo');
    await mkdir(validWorkDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(path.join(workspaceRoot, userSlug), { recursive: true, force: true });
  });

  async function start(ws: FakeWS, payload: unknown): Promise<void> {
    await handleMessage(asWS(ws), JSON.stringify({ type: 'start_session', payload }));
  }

  it('includes ultracode:true in the inserted session row', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    // No provider resolves → spawn throws provider_unset, but the INSERT already
    // landed (it happens before the query spawn).
    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: validWorkDir, content: 'hello', ultracode: true });

    const insert = fake.calls.find((c) => c.op === 'insert' && c.table === 'sessions');
    expect(insert).toBeDefined();
    expect((insert?.values as { ultracode?: boolean }).ultracode).toBe(true);
  });

  it('defaults ultracode to false when omitted', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: validWorkDir, content: 'hello' });

    const insert = fake.calls.find((c) => c.op === 'insert' && c.table === 'sessions');
    expect((insert?.values as { ultracode?: boolean }).ultracode).toBe(false);
  });

  it('rejects a non-boolean ultracode with bad_request, inserting no row', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: validWorkDir, content: 'hello', ultracode: 'yes' });

    expect(wsErrors(ws).at(-1)?.payload.code).toBe('bad_request');
    expect(fake.calls.filter((c) => c.op === 'insert').length).toBe(0);
  });
});

describe('buildSnapshot — ultracode', () => {
  function sessionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sess-1',
      workDir: '/tmp/snap-ultracode',
      totalTokens: 0,
      totalCostUsd: '0',
      title: null,
      pendingPrompt: null,
      pendingEnqueuedAt: null,
      thinking: false,
      approvalMode: 'ask',
      effort: null,
      ultracode: false,
      ...overrides,
    };
  }

  it('carries the persisted ultracode from the session row', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([sessionRow({ ultracode: true })]); // sessions row
    fake.selectQueue.push([]); // no transcript

    const snap = await buildSnapshot({
      sessionId: 'sess-1',
      db: fake.db,
      manager: new SessionManager(),
    });

    expect(snap).not.toBeNull();
    expect(snap?.ultracode).toBe(true);
  });

  it('reflects ultracode:false from the row', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([sessionRow({ ultracode: false })]);
    fake.selectQueue.push([]);

    const snap = await buildSnapshot({
      sessionId: 'sess-1',
      db: fake.db,
      manager: new SessionManager(),
    });

    expect(snap?.ultracode).toBe(false);
  });

  it('emptySnapshot has ultracode:false', () => {
    expect(emptySnapshot().ultracode).toBe(false);
  });
});
