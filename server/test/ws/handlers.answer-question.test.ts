import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import type { QuestionRequestPayload } from 'shared/types';
import { KimiSessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeControlledTurn, makeFakeDb, stubSession, wsErrors } from '../_helpers';

// Tests for the `answer_question` WS handler. The handler is fully synchronous
// w.r.t. the manager's pendingQuestions Map — no pump or SDK iterator is
// driven; we install a controlled Turn and a hand-built PendingQuestion entry
// directly, then assert on respondQuestion forwarding, error codes, and
// pendingQuestions cleanup semantics.

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

function stubQuestionPayload(requestId: string): QuestionRequestPayload {
  return { id: `tc-${requestId}`, requestId, questions: [] };
}

describe('handlers — answer_question', () => {
  describe('A. happy path', () => {
    it('forwards (rpcId, reqId, answers) to turn.respondQuestion and clears pending entry', async () => {
      const turn = makeControlledTurn();
      const session = stubSession();
      const active = registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');
      manager.attachWS(active, asWS(ws));

      const respondCalls = turn.respondQuestionCalls;

      active.pendingQuestions.set('q-1', {
        rpcRequestId: 'q-1',
        questionRequestId: 'q-1',
        payload: stubQuestionPayload('q-1'),
        turn: turn.turn,
      });

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          payload: { requestId: 'q-1', answers: { '0': 'option-1' } },
        }),
      );

      expect(respondCalls).toEqual([
        { rpcRequestId: 'q-1', questionRequestId: 'q-1', answers: { '0': 'option-1' } },
      ]);
      expect(active.pendingQuestions.has('q-1')).toBe(false);
      expect(wsErrors(ws).length).toBe(0);
    });
  });

  describe('B. bad_request — payload missing', () => {
    it('emits error code bad_request when payload is undefined', async () => {
      const session = stubSession();
      registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          // payload intentionally omitted (becomes undefined)
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('bad_request');
    });
  });

  describe('C. bad_request — answers not Record<string,string>', () => {
    it('rejects answers with numeric value', async () => {
      const session = stubSession();
      registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          payload: { requestId: 'q-1', answers: { a: 1 } },
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('bad_request');
    });

    it('rejects answers as a plain string', async () => {
      const session = stubSession();
      registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          payload: { requestId: 'q-1', answers: 'string' },
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('bad_request');
    });

    it('rejects answers as an array', async () => {
      const session = stubSession();
      registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          payload: { requestId: 'q-1', answers: ['a'] },
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('bad_request');
    });
  });

  describe('D. not_found — session does not exist or unauthorized', () => {
    it('emits not_found when sessionId is unknown', async () => {
      // No registerActive call — session simply does not exist.
      const ws = new FakeWS('alice');

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'doesnt-exist',
          payload: { requestId: 'q-1', answers: { '0': 'option-1' } },
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('not_found');
    });
  });

  describe('E. not_found — pendingQuestions does not have requestId', () => {
    it('emits not_found when the requestId is not in pendingQuestions', async () => {
      const session = stubSession();
      registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          payload: { requestId: 'q-1', answers: { '0': 'option-1' } },
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('not_found');
    });
  });

  describe('F. answer_failed retryable on respondQuestion reject', () => {
    it('emits answer_failed retryable=true and keeps pending entry intact', async () => {
      const turn = makeControlledTurn();
      const session = stubSession();
      const active = registerActive('sess-A', 'alice', session);
      const ws = new FakeWS('alice');
      manager.attachWS(active, asWS(ws));

      turn.failNextRespondQuestion(new Error('rpc fail'));

      active.pendingQuestions.set('q-1', {
        rpcRequestId: 'q-1',
        questionRequestId: 'q-1',
        payload: stubQuestionPayload('q-1'),
        turn: turn.turn,
      });

      await handleMessage(
        asWS(ws),
        JSON.stringify({
          type: 'answer_question',
          sessionId: 'sess-A',
          payload: { requestId: 'q-1', answers: { '0': 'option-1' } },
        }),
      );

      const errors = wsErrors(ws);
      expect(errors[0]?.payload.code).toBe('answer_failed');
      expect(errors[0]?.payload.retryable).toBe(true);
      // Pending entry NOT deleted on failure — client may retry.
      expect(active.pendingQuestions.has('q-1')).toBe(true);
    });
  });
});
