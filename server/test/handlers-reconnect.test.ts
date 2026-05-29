import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realFsPromises from 'node:fs/promises';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import type { ReplayDonePayload, SnapshotPayload, WSMessage } from 'shared/types';
import type { DB } from '../src/db';
import { broadcastEvent } from '../src/lib/ws-broadcast';
import { type ActiveSession, KimiSessionManager } from '../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb } from './_helpers';

// Snapshot the real export bindings before `mock.module` swaps them.
// `import * as realFsPromises` resolves through the live namespace, so after
// the mock is installed, `realFsPromises.readFile` *is* the mock — using it
// inside the mock would recurse forever in bundled mode.
const originalReadFile = realFsPromises.readFile;

mock.module('node:fs/promises', () => {
  return {
    ...realFsPromises,
    readFile: async (path: string, encoding?: any) => {
      if (path.endsWith('wire.jsonl')) {
        const err = new Error('ENOENT: no such file or directory');
        (err as any).code = 'ENOENT';
        throw err;
      }
      return originalReadFile(path, encoding);
    },
  };
});

afterAll(() => {
  mock.restore();
});

// Reconnect / replay tests for `subscribe` and `resume_session`. Plan §5b
// invariants exercised:
//   - lastSeq inside buffer → diff only
//   - lastSeq outside buffer → snapshot
//   - lastSeq omitted → snapshot
//   - cross-user / closed session → not_found
//   - restart (no in-memory) → restoreFn invoked, snapshot from DB
//   - empty-backup zero-turn → restoreFn returns active with empty snapshot

const stubKimi = {} as unknown as Session;

function registerActive(
  manager: KimiSessionManager,
  args: { sessionId: string; userId: string; bufferCapacity?: number },
): ActiveSession {
  return manager.register({
    sessionId: args.sessionId,
    userId: args.userId,
    workDir: '/tmp/work',
    kimiSessionId: `kimi-${args.sessionId}`,
    kimiSession: stubKimi,
    ...(args.bufferCapacity ? { bufferCapacity: args.bufferCapacity } : {}),
  });
}

function withRows<T>(fakeDb: ReturnType<typeof makeFakeDb>, ...rows: T[][]): void {
  if (rows.length === 2) {
    const sessionRow = rows[0]?.[0] as any;
    if (sessionRow && 'status' in sessionRow) {
      const sess = {
        id: sessionRow.id ?? 'sess-A',
        userId: sessionRow.userId ?? 'alice',
        workDir: sessionRow.workDir ?? '/tmp/work',
        kimiSessionId: sessionRow.kimiSessionId ?? 'kimi-sess-A',
        status: sessionRow.status ?? 'active',
        totalTokens: sessionRow.totalTokens ?? 0,
        title: sessionRow.title ?? null,
        pendingPrompt: null,
        pendingEnqueuedAt: null,
      };
      const fileRow = {
        wireJsonl: '',
        contextJsonl: '',
        stateJson: '',
        wireByteOffset: 0,
      };
      const pendingRow = {
        pendingPrompt: null,
        pendingEnqueuedAt: null,
      };
      fakeDb.selectQueue.push([sess]);
      fakeDb.selectQueue.push([fileRow]);
      fakeDb.selectQueue.push([pendingRow]);
      return;
    }
  }
  for (const r of rows) fakeDb.selectQueue.push(r);
}

let manager: KimiSessionManager;
let fakeDb: ReturnType<typeof makeFakeDb>;

beforeEach(() => {
  manager = new KimiSessionManager();
  fakeDb = makeFakeDb();
  setHandlerDeps({ manager, db: fakeDb.db });
});

afterEach(() => {
  setHandlerDeps(null);
});

function findReplayDone(ws: FakeWS): WSMessage<ReplayDonePayload> | null {
  for (const msg of ws.parsed()) {
    if (msg.type === 'replay_done') return msg as WSMessage<ReplayDonePayload>;
  }
  return null;
}

describe('subscribe — in-memory active', () => {
  it('lastSeq inside buffer → only diff messages, no snapshot', async () => {
    const active = registerActive(manager, { sessionId: 'sess-A', userId: 'alice' });
    // Push 3 events into the buffer pre-subscribe.
    broadcastEvent(active, 'text_delta', { text: 'one' }, manager);
    broadcastEvent(active, 'text_delta', { text: 'two' }, manager);
    broadcastEvent(active, 'text_delta', { text: 'three' }, manager);

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A', lastSeq: 1 },
      }),
    );

    const types = ws.parsed().map((m) => m.type);
    expect(types).not.toContain('snapshot');
    // Diff: seq 2, 3 → text_delta x2 + replay_done.
    expect(types).toEqual(['text_delta', 'text_delta', 'replay_done']);
    expect(findReplayDone(ws)?.payload.lastSeq).toBe(active.lastSeq);
  });

  it('lastSeq omitted → snapshot + replay_done', async () => {
    const active = registerActive(manager, { sessionId: 'sess-A', userId: 'alice' });
    broadcastEvent(active, 'text_delta', { text: 'history' }, manager);
    // Snapshot will go through buildSnapshot → fake db needs rows.
    withRows(
      fakeDb,
      [{ status: 'active', totalTokens: 0, title: null }], // session row
      [], // empty messages
    );

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A' },
      }),
    );

    const types = ws.parsed().map((m) => m.type);
    expect(types).toEqual(['snapshot', 'replay_done']);
    const snap = ws.parsed()[0];
    expect((snap?.payload as SnapshotPayload).status).toBe('active');
  });

  it('lastSeq beyond buffer capacity → snapshot fallback', async () => {
    const active = registerActive(manager, {
      sessionId: 'sess-A',
      userId: 'alice',
      bufferCapacity: 2,
    });
    // Pump enough events that lastSeq=1 is no longer in the 2-slot buffer.
    for (let i = 0; i < 10; i++) {
      broadcastEvent(active, 'text_delta', { text: `${i}` }, manager);
    }
    withRows(fakeDb, [{ status: 'active', totalTokens: 0, title: null }], []);

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A', lastSeq: 1 },
      }),
    );

    const types = ws.parsed().map((m) => m.type);
    expect(types).toContain('snapshot');
  });

  it('lastSeq ahead of server (server restart with stale client) → snapshot fallback', async () => {
    registerActive(manager, { sessionId: 'sess-A', userId: 'alice' });
    withRows(fakeDb, [{ status: 'active', totalTokens: 0, title: null }], []);

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A', lastSeq: 999 },
      }),
    );

    const types = ws.parsed().map((m) => m.type);
    expect(types).toContain('snapshot');
  });

  it('cross-user subscribe → not_found, no snapshot', async () => {
    registerActive(manager, { sessionId: 'sess-A', userId: 'alice' });
    const ws = new FakeWS('bob');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A' },
      }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error');
    expect(errors.length).toBe(1);
    expect((errors[0]?.payload as { code: string }).code).toBe('not_found');
    expect(ws.parsed().some((m) => m.type === 'snapshot')).toBe(false);
  });
});

describe('resume_session — always snapshots', () => {
  it('ignores lastSeq, emits snapshot + replay_done', async () => {
    const active = registerActive(manager, { sessionId: 'sess-A', userId: 'alice' });
    broadcastEvent(active, 'text_delta', { text: 'x' }, manager);
    withRows(fakeDb, [{ status: 'active', totalTokens: 0, title: null }], []);

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'resume_session',
        payload: { sessionId: 'sess-A' },
      }),
    );

    const types = ws.parsed().map((m) => m.type);
    expect(types).toEqual(['snapshot', 'replay_done']);
  });
});

describe('subscribe — restore path (not in memory)', () => {
  function makeRestoreFn(onCall: () => ActiveSession | Error): {
    fn: (sessionId: string, mgr: KimiSessionManager, dbh: DB) => Promise<ActiveSession>;
    callCount: () => number;
  } {
    let count = 0;
    return {
      fn: async () => {
        count += 1;
        const r = onCall();
        if (r instanceof Error) throw r;
        return r;
      },
      callCount: () => count,
    };
  }

  it('restart scenario: subscribe triggers restoreFn, returns snapshot', async () => {
    const restoredActive = registerActive(manager, {
      sessionId: 'sess-A',
      userId: 'alice',
    });
    // Manually unregister to simulate "not in memory".
    manager.unregister('sess-A');
    // Re-register on restoreFn invocation, returning a fresh active.
    const restore = makeRestoreFn(() =>
      manager.register({
        sessionId: 'sess-A',
        userId: 'alice',
        workDir: restoredActive.workDir,
        kimiSessionId: restoredActive.kimiSessionId,
        kimiSession: stubKimi,
      }),
    );
    setHandlerDeps({ manager, db: fakeDb.db, restore: restore.fn });
    withRows(fakeDb, [{ status: 'active', totalTokens: 0, title: null }], []);

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A' },
      }),
    );

    expect(restore.callCount()).toBe(1);
    const types = ws.parsed().map((m) => m.type);
    expect(types).toEqual(['snapshot', 'replay_done']);
  });

  it('restoreFn throws not_found → handler responds not_found', async () => {
    const restore = makeRestoreFn(() => new Error('not_found'));
    setHandlerDeps({ manager, db: fakeDb.db, restore: restore.fn });

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-ghost' },
      }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error');
    expect(errors.length).toBe(1);
    expect((errors[0]?.payload as { code: string }).code).toBe('not_found');
  });

  it('restored session owned by different user → not_found, no leak', async () => {
    // Restore returns an active owned by 'alice'; bob subscribes — must 404.
    const restore = makeRestoreFn(() =>
      manager.register({
        sessionId: 'sess-A',
        userId: 'alice',
        workDir: '/tmp/work',
        kimiSessionId: 'kimi-sess-A',
        kimiSession: stubKimi,
      }),
    );
    setHandlerDeps({ manager, db: fakeDb.db, restore: restore.fn });

    const ws = new FakeWS('bob');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A' },
      }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error');
    expect((errors[0]?.payload as { code: string }).code).toBe('not_found');
  });
});

describe('attachWS — invariant #4 ordering', () => {
  it('attaches before reading buffer, so live events between attach and since() reach the new socket', async () => {
    const active = registerActive(manager, {
      sessionId: 'sess-A',
      userId: 'alice',
      bufferCapacity: 16,
    });
    broadcastEvent(active, 'text_delta', { text: 'pre' }, manager);

    const ws = new FakeWS('alice');
    // Synthesize: subscribe with lastSeq=1 (buffer holds seq=1, so diff=[]).
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'subscribe',
        payload: { sessionId: 'sess-A', lastSeq: 1 },
      }),
    );
    // Now push a live event after attach.
    broadcastEvent(active, 'text_delta', { text: 'live' }, manager);

    const liveDeltas = ws
      .parsed()
      .filter((m) => m.type === 'text_delta')
      .map((m) => (m.payload as { text: string }).text);
    expect(liveDeltas).toContain('live');
  });
});
