import { describe, expect, it } from 'bun:test';
import { pumpTurn } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
import { asWS, FakeWS, makeControlledTurn, makeFakeDb, stubSession } from '../_helpers';

// Tests for `pumpTurn`'s handling of QuestionRequest events. We bypass the WS
// `send_message` handler and drive `pumpTurn` directly with a controlled Turn,
// asserting on:
//   - DB inserts via the fake DB (insertQuestionMessage row, orphan
//     `<question not answered>` tool_result rows)
//   - In-memory `active.pendingQuestions` Map population/cleanup
// All three cases share the same setup; only the cancel/finish/answered branch
// differs.

async function settled(p: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!p()) {
    if (Date.now() - start > timeoutMs) throw new Error('settled: timed out');
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface Harness {
  manager: KimiSessionManager;
  fake: ReturnType<typeof makeFakeDb>;
  active: ReturnType<KimiSessionManager['register']>;
  ws: FakeWS;
  turn: ReturnType<typeof makeControlledTurn>;
  pumpDone: Promise<void>;
}

function setupPump(): Harness {
  const fake = makeFakeDb();
  const manager = new KimiSessionManager();
  const active = manager.register({
    sessionId: 'sess-A',
    userId: 'alice',
    workDir: '/tmp/work',
    kimiSessionId: 'kimi-stub',
    kimiSession: stubSession(),
  });
  const ws = new FakeWS('alice');
  manager.attachWS(active, asWS(ws));

  const turn = makeControlledTurn();
  active.currentTurn = turn.turn;

  // Detached pump — capture the promise so each test can await it once the
  // turn is drained, but errors must not crash the test runner.
  const pumpDone = pumpTurn(active, turn.turn, { manager, db: fake.db }).catch(() => undefined);

  return { manager, fake, active, ws, turn, pumpDone };
}

function pushQuestion(turn: Harness['turn']): void {
  // SDK shape: {id, tool_call_id, questions:[{question, options, multi_select}]}.
  // Translator maps id → payload.requestId (Map key) and tool_call_id →
  // payload.id (used in pump's cleanup `toolNameByCallId.get(p.id)` lookup).
  turn.push({
    type: 'QuestionRequest',
    payload: {
      id: 'q-1',
      tool_call_id: 'tc-1',
      questions: [
        {
          question: 'Pick one',
          options: [{ label: 'A' }],
          multi_select: false,
        },
      ],
    },
    // biome-ignore lint/suspicious/noExplicitAny: SDK StreamEvent shape varies; tests use the on-wire snake_case form.
  } as any);
}

describe('pumpTurn — QuestionRequest handling', () => {
  it('A. populates pendingQuestions and inserts a question DB row', async () => {
    const { fake, active, turn, pumpDone } = setupPump();

    pushQuestion(turn);

    await settled(() => active.pendingQuestions.has('q-1'));

    const inserts = fake.calls.filter((c) => c.op === 'insert');
    const qInsert = inserts.find((c) => (c.values as { role?: string }).role === 'question');
    expect(qInsert).toBeDefined();
    expect((qInsert as unknown as { values: { toolInput: unknown } }).values.toolInput).toEqual({
      requestId: 'q-1',
      questions: [
        {
          question: 'Pick one',
          options: [{ label: 'A' }],
          multiSelect: false,
        },
      ],
    });

    // Drain so the detached pump completes cleanly.
    turn.end({ status: 'finished', steps: 1 });
    await pumpDone;
  });

  it('B. cancelled turn with leftover pendingQuestion → inserts <question not answered>', async () => {
    const { fake, active, ws, turn, pumpDone } = setupPump();

    pushQuestion(turn);
    await settled(() => active.pendingQuestions.has('q-1'));

    // Do not answer — simulate user interrupt.
    turn.end({ status: 'cancelled', steps: 1 });

    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
    await pumpDone;

    const turnEnd = ws.parsed().find((m) => m.type === 'turn_end');
    expect((turnEnd?.payload as { status: string }).status).toBe('cancelled');

    const inserts = fake.calls.filter((c) => c.op === 'insert');
    const orphan = inserts.find((c) => {
      const v = c.values as { role?: string; content?: string; isError?: boolean };
      return (
        v.role === 'tool-result' && v.content === '<question not answered>' && v.isError === true
      );
    });
    expect(orphan).toBeDefined();
    expect(active.pendingQuestions.size).toBe(0);
  });

  it('C. finished turn with answered question → no orphan tool_result inserted', async () => {
    const { fake, active, ws, turn, pumpDone } = setupPump();

    pushQuestion(turn);
    await settled(() => active.pendingQuestions.has('q-1'));

    // Simulate the `answer_question` handler having processed the response.
    active.pendingQuestions.delete('q-1');

    turn.end({ status: 'finished', steps: 1 });

    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
    await pumpDone;

    const inserts = fake.calls.filter((c) => c.op === 'insert');
    const orphan = inserts.find((c) => {
      const v = c.values as { content?: string };
      return v.content === '<question not answered>';
    });
    expect(orphan).toBeUndefined();
    expect(active.pendingQuestions.size).toBe(0);
  });
});
