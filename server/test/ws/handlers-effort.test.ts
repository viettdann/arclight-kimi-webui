import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { EffortLevel } from 'shared/types';
import type { ActiveSession } from '../../src/services/session-manager';
import { SessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, wsErrors } from '../_helpers';

// Effort rides along with send_message exactly like thinking/approvalMode: a
// changed value updates the in-memory session, is pushed to the live query via
// applyFlagSettings, and is persisted to the sessions row. A live query is
// pre-attached so ensureQuery is a no-op (no real subprocess spawn).

interface FlagCall {
  effortLevel?: EffortLevel | null;
}

function attachLiveQuery(active: ActiveSession): { flagCalls: FlagCall[]; pushed: string[] } {
  const flagCalls: FlagCall[] = [];
  const pushed: string[] = [];
  active.query = {
    applyFlagSettings: async (settings: FlagCall) => {
      flagCalls.push(settings);
    },
  } as unknown as ActiveSession['query'];
  active.bridge = {
    push: (text: string) => pushed.push(text),
  } as unknown as ActiveSession['bridge'];
  return { flagCalls, pushed };
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

describe('handleSendMessage — effort ride-along', () => {
  it('applies a changed effort: in-memory + live query + persisted row', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      effort: null,
    });
    const { flagCalls, pushed } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', effort: 'high' });

    // In-memory updated.
    expect(active.effort).toBe('high');
    // Live query received the flag.
    expect(flagCalls).toEqual([{ effortLevel: 'high' }]);
    // Persisted to the sessions row.
    const update = fake.calls.find((c) => c.op === 'update');
    expect((update?.values as { effort?: string }).effort).toBe('high');
    // The turn still proceeds: the prompt is pushed to the bridge.
    expect(pushed).toEqual(['hi']);
    expect(wsErrors(alice)).toHaveLength(0);
  });

  it('null resets effort to the provider default', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      effort: 'high',
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', effort: null });

    expect(active.effort).toBeNull();
    expect(flagCalls).toEqual([{ effortLevel: null }]);
    const update = fake.calls.find((c) => c.op === 'update');
    expect((update?.values as { effort?: string | null }).effort).toBeNull();
  });

  it('leaves effort unchanged when omitted (no flag call, no persist)', async () => {
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      effort: 'medium',
    });
    const { flagCalls } = attachLiveQuery(active);
    manager.attachWS(active, asWS(new FakeWS('alice')));

    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi' });

    expect(active.effort).toBe('medium');
    expect(flagCalls).toEqual([]);
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('rejects an invalid effort value with bad_request', async () => {
    manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      effort: null,
    });
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await send(alice, { content: 'hi', effort: 'turbo' });

    expect(wsErrors(alice).at(-1)?.payload.code).toBe('bad_request');
  });
});
