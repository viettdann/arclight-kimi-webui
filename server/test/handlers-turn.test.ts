import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ContentPart, Session, Turn } from '@moonshot-ai/kimi-agent-sdk';
import type { ApprovalRequestPayload, WSMessage } from 'shared/types';
import { KimiSessionManager } from '../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../src/ws/handlers';
import { asWS, type ControlledTurn, FakeWS, makeControlledTurn, makeFakeDb } from './_helpers';

// Tests for the turn lifecycle: pump + handler integration via send_message,
// approve_tool, interrupt_turn. We bypass create_session so we don't need to
// stand up the SDK; instead we register an `ActiveSession` directly in the
// manager and feed it a scripted SDK `Session` whose `prompt()` returns a
// controlled `Turn`.

interface Scripted {
  session: Session;
  prompts: string[];
  next: ControlledTurn;
}

function scriptableSession(turn: Turn): Scripted {
  const prompts: string[] = [];
  const session = {
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
    prompt: (content: string | ContentPart[]) => {
      prompts.push(typeof content === 'string' ? content : JSON.stringify(content));
      return turn;
    },
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  } as unknown as Session;
  return { session, prompts, next: {} as ControlledTurn };
}

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

async function tick(): Promise<void> {
  // Yield to the event loop so the detached pump can advance.
  await new Promise((res) => setTimeout(res, 0));
}

async function settled(p: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!p()) {
    if (Date.now() - start > timeoutMs) throw new Error('settled: timed out');
    await tick();
  }
}

describe('handlers — happy path turn streaming', () => {
  it('emits monotonic seq, accumulates text, broadcasts turn_end with finished', async () => {
    const turn = makeControlledTurn();
    const { session } = scriptableSession(turn.turn);
    const active = registerActive('sess-A', 'alice', session);

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'hello' },
      }),
    );

    // Drive the scripted turn.
    turn.push({ type: 'TurnBegin', payload: { user_input: 'hello' } });
    turn.push({ type: 'StepBegin', payload: { n: 1 } });
    turn.push({ type: 'ContentPart', payload: { type: 'text', text: 'Hi ' } });
    turn.push({ type: 'ContentPart', payload: { type: 'text', text: 'there' } });
    turn.push({
      type: 'StatusUpdate',
      payload: {
        token_usage: {
          input_other: 5,
          output: 10,
          input_cache_read: 0,
          input_cache_creation: 0,
        },
        context_usage: 100,
      },
    });
    turn.end({ status: 'finished', steps: 2 });

    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
    // Pump's post-broadcast cleanup runs after turn_end (backup + state reset).
    // Wait for the cleanup signal before asserting reset state.
    await settled(() => active.lastStatusUpdate === null);

    const seqs = ws.parsed().map((m) => m.seq);
    // Strictly increasing seqs.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] ?? 0);
    }

    const types = ws.parsed().map((m) => m.type);
    expect(types).toEqual([
      'turn_begin',
      'step_begin',
      'text_delta',
      'text_delta',
      'status_update',
      'turn_end',
    ]);

    const turnEnd = ws.parsed().find((m) => m.type === 'turn_end');
    expect(turnEnd?.payload).toEqual({ status: 'finished', steps: 2 });

    // Invariant #2: currentTurn cleared by the time turn_end is observable.
    expect(active.currentTurn).toBeNull();

    // Translator and per-turn state reset for next turn.
    expect(active.lastStatusUpdate).toBeNull();
    expect(active.toolNameByCallId.size).toBe(0);
    expect(active.translator.lastToolCallId).toBeNull();
  });

  it('routes events to the correct session when a user owns multiple actives', async () => {
    const turns = [makeControlledTurn(), makeControlledTurn(), makeControlledTurn()];
    const sessions = turns.map((t) => scriptableSession(t.turn));
    const actives = sessions.map((s, i) => registerActive(`s${i + 1}`, 'alice', s.session));
    const sockets = actives.map(() => new FakeWS('alice'));
    actives.forEach((a, i) => {
      const sock = sockets[i];
      if (sock) manager.attachWS(a, asWS(sock));
    });

    for (let i = 0; i < 3; i++) {
      await handleMessage(
        asWS(sockets[i] as FakeWS),
        JSON.stringify({
          type: 'send_message',
          sessionId: `s${i + 1}`,
          payload: { content: `msg-${i}` },
        }),
      );
    }

    for (let i = 0; i < 3; i++) {
      turns[i]?.push({
        type: 'ContentPart',
        payload: { type: 'text', text: `r${i}` },
      });
      turns[i]?.end({ status: 'finished', steps: 1 });
    }

    await settled(() => sockets.every((s) => s.parsed().some((m) => m.type === 'turn_end')));

    for (let i = 0; i < 3; i++) {
      const sock = sockets[i] as FakeWS;
      const types = sock.parsed().map((m) => `${m.type}:${m.sessionId}`);
      // Each socket only sees its own session's events.
      for (const t of types) {
        expect(t.endsWith(`:s${i + 1}`)).toBe(true);
      }
      const text = sock
        .parsed()
        .filter((m) => m.type === 'text_delta')
        .map((m) => (m.payload as { text: string }).text)
        .join('');
      expect(text).toBe(`r${i}`);
    }
  });
});

describe('handlers — approval flow', () => {
  it('forwards approve_tool to SDK turn.approve with positional args', async () => {
    const turn = makeControlledTurn();
    const { session } = scriptableSession(turn.turn);
    const active = registerActive('sess-A', 'alice', session);
    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'do it' },
      }),
    );

    turn.push({
      type: 'ToolCall',
      payload: {
        id: 'tc-1',
        type: 'function',
        function: { name: 'shell', arguments: { cmd: 'ls' } },
      },
    });
    turn.push({
      type: 'ApprovalRequest',
      payload: {
        id: 'req-1',
        tool_call_id: 'tc-1',
        action: 'shell',
        description: 'Run ls',
      },
    });

    await settled(() => active.pendingApprovals.has('req-1'));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'approve_tool',
        sessionId: 'sess-A',
        payload: { requestId: 'req-1', response: 'approve_for_session' },
      }),
    );

    expect(turn.approveCalls).toEqual([{ requestId: 'req-1', response: 'approve_for_session' }]);
    expect(active.pendingApprovals.has('req-1')).toBe(false);

    // Drive turn to completion so test doesn't leak pump promises.
    turn.end({ status: 'finished', steps: 1 });
    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
  });

  it('cancellation flushes leftover pendingApprovals as terminal tool_result rows', async () => {
    const turn = makeControlledTurn();
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });
    const { session } = scriptableSession(turn.turn);
    const active = registerActive('sess-A', 'alice', session);
    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'hi' },
      }),
    );

    turn.push({
      type: 'ToolCall',
      payload: {
        id: 'tc-1',
        type: 'function',
        function: { name: 'shell', arguments: null },
      },
    });
    turn.push({
      type: 'ApprovalRequest',
      payload: {
        id: 'req-1',
        tool_call_id: 'tc-1',
        action: 'shell',
        description: 'desc',
      } satisfies {
        id: string;
        tool_call_id: string;
        action: string;
        description: string;
      } as unknown as ApprovalRequestPayload extends infer X ? X : never,
    });

    await settled(() => active.pendingApprovals.has('req-1'));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'interrupt_turn',
        sessionId: 'sess-A',
      }),
    );
    expect(turn.interruptCalls).toBeGreaterThanOrEqual(1);

    turn.end({ status: 'cancelled', steps: 1 });
    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));

    const turnEnd = ws.parsed().find((m) => m.type === 'turn_end');
    expect((turnEnd?.payload as { status: string }).status).toBe('cancelled');
    expect(active.pendingApprovals.size).toBe(0);

    // Terminal tool_result row was inserted by the pump for the orphan approval.
    const inserts = fake.calls.filter((c) => c.op === 'insert');
    const hasOrphanResult = inserts.some((c) => {
      const v = c.values as { role?: string; content?: string };
      return v.role === 'tool-result' && v.content === '<approval not answered>';
    });
    expect(hasOrphanResult).toBe(true);
  });
});

describe('handlers — concurrency guard', () => {
  it('rejects send_message while currentTurn is active with turn_in_progress', async () => {
    const turn = makeControlledTurn();
    const { session } = scriptableSession(turn.turn);
    const active = registerActive('sess-A', 'alice', session);
    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'first' },
      }),
    );
    // Pump now in flight; second send must be rejected.
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-A',
        payload: { content: 'second' },
      }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error') as WSMessage<{
      code: string;
      message: string;
      retryable: boolean;
    }>[];
    expect(errors.some((e) => e.payload.code === 'turn_in_progress')).toBe(true);

    turn.end({ status: 'finished', steps: 1 });
    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
  });
});
