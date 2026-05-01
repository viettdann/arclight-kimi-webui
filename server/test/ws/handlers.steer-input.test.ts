import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import { KimiSessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeControlledTurn, makeFakeDb, stubSession, wsErrors } from '../_helpers';

// Tests for the `steer_input` WS handler. We bypass the SDK pump and drive the
// handler directly by manually setting `active.currentTurn` to a controlled
// Turn whose `steer` method we override per case.

let manager: KimiSessionManager;

beforeEach(() => {
  manager = new KimiSessionManager();
  const fake = makeFakeDb();
  setHandlerDeps({ manager, db: fake.db });
});

afterEach(() => {
  setHandlerDeps(null);
});

function registerActive(
  sessionId: string,
  userId: string,
  session: Session,
): ReturnType<KimiSessionManager['register']> {
  return manager.register({
    sessionId,
    userId,
    workDir: '/tmp/work',
    kimiSessionId: 'kimi-stub',
    kimiSession: session,
  });
}

describe('handlers — steer_input happy path', () => {
  it('forwards content to currentTurn.steer when session has an active turn', async () => {
    const turn = makeControlledTurn();
    const active = registerActive('sess-A', 'alice', stubSession());
    active.currentTurn = turn.turn;

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'sess-A',
        payload: { content: 'hello there' },
      }),
    );

    expect(turn.steerCalls).toEqual(['hello there']);
    expect(wsErrors(ws)).toEqual([]);
  });
});

describe('handlers — steer_input bad_request', () => {
  it('rejects when payload is missing', async () => {
    const turn = makeControlledTurn();
    const active = registerActive('sess-A', 'alice', stubSession());
    active.currentTurn = turn.turn;

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'sess-A',
      }),
    );

    const errs = wsErrors(ws);
    expect(errs[0]?.payload.code).toBe('bad_request');
  });

  it('rejects when content is an empty string', async () => {
    const turn = makeControlledTurn();
    const active = registerActive('sess-A', 'alice', stubSession());
    active.currentTurn = turn.turn;

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'sess-A',
        payload: { content: '' },
      }),
    );

    const errs = wsErrors(ws);
    expect(errs[0]?.payload.code).toBe('bad_request');
  });

  it('rejects when content is not a string', async () => {
    const turn = makeControlledTurn();
    const active = registerActive('sess-A', 'alice', stubSession());
    active.currentTurn = turn.turn;

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'sess-A',
        payload: { content: 123 },
      }),
    );

    const errs = wsErrors(ws);
    expect(errs[0]?.payload.code).toBe('bad_request');
  });
});

describe('handlers — steer_input not_found', () => {
  it('returns not_found when sessionId is unknown to the manager', async () => {
    const ws = new FakeWS('alice');

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'unknown',
        payload: { content: 'hi' },
      }),
    );

    const errs = wsErrors(ws);
    expect(errs[0]?.payload.code).toBe('not_found');
  });
});

describe('handlers — steer_input no_turn', () => {
  it('returns no_turn (retryable=false) when active session has no currentTurn', async () => {
    const active = registerActive('sess-A', 'alice', stubSession());
    // Leave active.currentTurn === null (default).
    expect(active.currentTurn).toBeNull();

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'sess-A',
        payload: { content: 'hi' },
      }),
    );

    const errs = wsErrors(ws);
    expect(errs[0]?.payload.code).toBe('no_turn');
    expect(errs[0]?.payload.retryable).toBe(false);
  });
});

describe('handlers — steer_input steer_failed', () => {
  it('returns steer_failed (retryable=true) when currentTurn.steer rejects', async () => {
    const turn = makeControlledTurn();
    const active = registerActive('sess-A', 'alice', stubSession());
    active.currentTurn = turn.turn;

    turn.failNextSteer(new Error('boom'));

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'steer_input',
        sessionId: 'sess-A',
        payload: { content: 'hi' },
      }),
    );

    const errs = wsErrors(ws);
    expect(errs[0]?.payload.code).toBe('steer_failed');
    expect(errs[0]?.payload.retryable).toBe(true);
  });
});
