import { describe, expect, it } from 'bun:test';
import { pumpTurn } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
import { asWS, FakeWS, makeControlledTurn, makeFakeDb, stubSession } from '../_helpers';

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

  // Detached pump
  const pumpDone = pumpTurn(active, turn.turn, { manager, db: fake.db }).catch(() => undefined);

  return { manager, fake, active, ws, turn, pumpDone };
}

function pushQuestion(turn: Harness['turn']): void {
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
  } as any);
}

describe('pumpTurn — QuestionRequest handling', () => {
  it('A. populates pendingQuestions', async () => {
    const { active, turn, pumpDone } = setupPump();

    pushQuestion(turn);

    await settled(() => active.pendingQuestions.has('q-1'));
    expect(active.pendingQuestions.has('q-1')).toBe(true);

    // Drain so the pump completes cleanly.
    turn.end({ status: 'finished', steps: 1 });
    await pumpDone;
  });

  it('B. cancelled turn with leftover pendingQuestion → clears pendingQuestion map', async () => {
    const { active, ws, turn, pumpDone } = setupPump();

    pushQuestion(turn);
    await settled(() => active.pendingQuestions.has('q-1'));

    turn.end({ status: 'cancelled', steps: 1 });

    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
    await pumpDone;

    expect(active.pendingQuestions.size).toBe(0);
  });

  it('C. finished turn with answered question → clears pendingQuestion map', async () => {
    const { active, ws, turn, pumpDone } = setupPump();

    pushQuestion(turn);
    await settled(() => active.pendingQuestions.has('q-1'));

    active.pendingQuestions.delete('q-1');

    turn.end({ status: 'finished', steps: 1 });

    await settled(() => ws.parsed().some((m) => m.type === 'turn_end'));
    await pumpDone;

    expect(active.pendingQuestions.size).toBe(0);
  });
});
