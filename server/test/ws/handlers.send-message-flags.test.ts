import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ContentPart, Session, Turn } from '@moonshot-ai/kimi-agent-sdk';
import { KimiSessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, type DbCall, FakeWS, makeControlledTurn, makeFakeDb, wsErrors } from '../_helpers';

// Composer flags ride along with `send_message` (there is no separate
// set_session_flags message). The handler applies them to the in-memory
// Session and persists the sessions row, but only for fields that actually
// flip — a resend with unchanged flags must not write the DB.

let manager: KimiSessionManager;

beforeEach(() => {
  manager = new KimiSessionManager();
});

afterEach(() => {
  setHandlerDeps(null);
});

/** Minimal SDK Session whose `prompt()` returns a controlled turn. */
function scriptableSession(turn: Turn): Session {
  return {
    sessionId: 'kimi-stub',
    workDir: '/tmp/work',
    state: 'idle',
    slashCommands: [],
    model: undefined,
    thinking: false,
    yoloMode: false,
    executable: '',
    env: {},
    externalTools: [],
    planMode: false,
    setPlanMode: async () => false,
    prompt: (_content: string | ContentPart[]) => turn,
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  } as unknown as Session;
}

function registerActive(session: Session) {
  return manager.register({
    sessionId: 'sess-A',
    userId: 'alice',
    workDir: '/tmp/work',
    kimiSessionId: 'kimi-stub',
    kimiSession: session,
  });
}

function findFlagUpdate(calls: DbCall[]) {
  return calls.find(
    (c) =>
      c.op === 'update' &&
      ((c.values as { thinking?: boolean }).thinking !== undefined ||
        (c.values as { yoloMode?: boolean }).yoloMode !== undefined),
  );
}

describe('handleSendMessage — composer flags', () => {
  it('applies thinking/yoloMode to the in-memory session and persists the flip', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const turn = makeControlledTurn();
    const session = scriptableSession(turn.turn);
    const active = registerActive(session);
    expect(active.kimiSession.thinking).toBe(false);
    expect(active.kimiSession.yoloMode).toBe(false);

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'hi', thinking: true, yoloMode: true },
      }),
    );

    expect(active.kimiSession.thinking).toBe(true);
    expect(active.kimiSession.yoloMode).toBe(true);

    const upd = findFlagUpdate(fake.calls);
    expect(upd).toBeDefined();
    expect((upd?.values as { thinking: boolean }).thinking).toBe(true);
    expect((upd?.values as { yoloMode: boolean }).yoloMode).toBe(true);
    expect(wsErrors(ws).length).toBe(0);
  });

  it('skips the flag DB write when the flags match the current values (spam-safe)', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    // Session already thinking=false/yolo=false; resend the same → no flag write.
    const turn = makeControlledTurn();
    const session = scriptableSession(turn.turn);
    const active = registerActive(session);

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'hi', thinking: false, yoloMode: false },
      }),
    );

    expect(findFlagUpdate(fake.calls)).toBeUndefined();
    expect(wsErrors(ws).length).toBe(0);
  });

  it('rejects bad_request for a non-boolean flag', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const turn = makeControlledTurn();
    const session = scriptableSession(turn.turn);
    const active = registerActive(session);

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'hi', thinking: 'yes' },
      }),
    );

    const errs = wsErrors(ws);
    expect(errs.length).toBe(1);
    expect(errs[0]?.payload.code).toBe('bad_request');
    expect(findFlagUpdate(fake.calls)).toBeUndefined();
  });
});
