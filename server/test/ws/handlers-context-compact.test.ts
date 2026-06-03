import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ContextUsagePayload } from 'shared/types';
import type { ActiveSession } from '../../src/services/session-manager';
import { SessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, wsErrors } from '../_helpers';

// Capture broadcasts so we can assert context_usage fan-out (and the absence of
// turn_begin on compact).
type Broadcast = { type: string; payload: unknown };
const broadcasts: Broadcast[] = [];
const realWsBroadcast = await import('../../src/lib/ws-broadcast');
mock.module('../../src/lib/ws-broadcast', () => ({
  ...realWsBroadcast,
  // Only broadcastEvent is intercepted; sendDirect (used by sendError) stays
  // real so error envelopes land on the FakeWS for wsErrors() to read.
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload });
    return { type, payload };
  },
}));

// A live query is pre-attached in every test so ensureQuery is a no-op — no real
// subprocess spawn. getContextUsage and bridge.push are recorded.
function attachLiveQuery(active: ActiveSession): {
  getContextUsageCalls: number;
  pushed: string[];
} {
  let getContextUsageCalls = 0;
  const pushed: string[] = [];
  active.query = {
    getContextUsage: async () => {
      getContextUsageCalls += 1;
      return {
        categories: [
          { name: 'Messages', tokens: 100, color: '#1' },
          { name: 'Free space', tokens: 900, color: '#2' },
        ],
        totalTokens: 100,
        maxTokens: 1000,
        rawMaxTokens: 1000,
        percentage: 10,
        model: 'kimi-k2',
        memoryFiles: [],
        mcpTools: [],
      };
    },
  } as unknown as ActiveSession['query'];
  active.bridge = {
    push: (text: string) => pushed.push(text),
  } as unknown as ActiveSession['bridge'];
  return {
    get getContextUsageCalls() {
      return getContextUsageCalls;
    },
    pushed,
  };
}

let manager: SessionManager;

beforeEach(() => {
  manager = new SessionManager();
  broadcasts.length = 0;
});

afterEach(() => {
  setHandlerDeps(null);
});

function registerOwned(): ActiveSession {
  const active = manager.register({
    sessionId: 'sess-1',
    userId: 'alice',
    workDir: '/tmp/work',
    approvalMode: 'ask',
  });
  manager.attachWS(active, asWS(new FakeWS('alice')));
  return active;
}

describe('request_context_usage', () => {
  it('resolves the session, keeps the live query, refreshes + broadcasts', async () => {
    const active = registerOwned();
    const live = attachLiveQuery(active);
    setHandlerDeps({ manager, db: makeFakeDb().db });

    const alice = new FakeWS('alice');
    await handleMessage(
      asWS(alice),
      JSON.stringify({ type: 'request_context_usage', sessionId: 'sess-1' }),
    );

    expect(live.getContextUsageCalls).toBe(1);
    const usage = broadcasts.find((b) => b.type === 'context_usage');
    expect(usage).toBeDefined();
    const payload = usage?.payload as ContextUsagePayload;
    // 'Free space' filtered out.
    expect(payload.categories).toEqual([{ name: 'Messages', tokens: 100 }]);
    expect(active.lastContextUsage).toEqual(payload);
    expect(wsErrors(alice)).toHaveLength(0);
  });

  it('rejects a missing sessionId with bad_request', async () => {
    setHandlerDeps({ manager, db: makeFakeDb().db });
    const alice = new FakeWS('alice');
    await handleMessage(asWS(alice), JSON.stringify({ type: 'request_context_usage' }));
    expect(wsErrors(alice).at(-1)?.payload.code).toBe('bad_request');
  });

  it('returns not_found for a session the user does not own', async () => {
    registerOwned();
    setHandlerDeps({
      manager,
      db: makeFakeDb().db,
      restore: async () => {
        throw new Error('not found');
      },
    });
    const bob = new FakeWS('bob');
    await handleMessage(
      asWS(bob),
      JSON.stringify({ type: 'request_context_usage', sessionId: 'sess-1' }),
    );
    expect(wsErrors(bob).at(-1)?.payload.code).toBe('not_found');
  });

  it('skips silently for a session with no provider (no error, no broadcast)', async () => {
    // No live query attached and no provider pinned: ensureQuery throws
    // ProviderUnavailableError. The passive probe must swallow it rather than
    // surface a SYSTEM_ERROR on a freshly created session.
    const active = registerOwned();
    expect(active.query).toBeNull();
    expect(active.providerId).toBeNull();
    setHandlerDeps({ manager, db: makeFakeDb().db });

    const alice = new FakeWS('alice');
    await handleMessage(
      asWS(alice),
      JSON.stringify({ type: 'request_context_usage', sessionId: 'sess-1' }),
    );

    expect(wsErrors(alice)).toHaveLength(0);
    expect(broadcasts.find((b) => b.type === 'context_usage')).toBeUndefined();
    expect(broadcasts.find((b) => b.type === 'error')).toBeUndefined();
  });
});

describe('compact_session', () => {
  it('pushes /compact onto the bridge and sets turnInProgress, no turn_begin', async () => {
    const active = registerOwned();
    const live = attachLiveQuery(active);
    setHandlerDeps({ manager, db: makeFakeDb().db });

    const alice = new FakeWS('alice');
    await handleMessage(
      asWS(alice),
      JSON.stringify({ type: 'compact_session', sessionId: 'sess-1' }),
    );

    expect(live.pushed).toEqual(['/compact']);
    expect(active.turnInProgress).toBe(true);
    expect(broadcasts.some((b) => b.type === 'turn_begin')).toBe(false);
    expect(wsErrors(alice)).toHaveLength(0);
  });

  it('is a silent no-op when a turn is already in progress', async () => {
    const active = registerOwned();
    const live = attachLiveQuery(active);
    active.turnInProgress = true;
    setHandlerDeps({ manager, db: makeFakeDb().db });

    const alice = new FakeWS('alice');
    await handleMessage(
      asWS(alice),
      JSON.stringify({ type: 'compact_session', sessionId: 'sess-1' }),
    );

    expect(live.pushed).toEqual([]);
    expect(wsErrors(alice)).toHaveLength(0);
  });

  it('rejects a missing sessionId with bad_request', async () => {
    setHandlerDeps({ manager, db: makeFakeDb().db });
    const alice = new FakeWS('alice');
    await handleMessage(asWS(alice), JSON.stringify({ type: 'compact_session' }));
    expect(wsErrors(alice).at(-1)?.payload.code).toBe('bad_request');
  });
});
