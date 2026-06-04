import { afterEach, describe, expect, it } from 'bun:test';
import type { ApprovalRequestPayload, QuestionRequestPayload } from 'shared/types';
import { SessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb } from '../_helpers';

// A parked canUseTool prompt (approval / AskUserQuestion) is broadcast exactly
// once when it parks; the transcript renderer cannot reconstruct it (the tool
// has not executed yet). These tests pin the attach-time replay: a client that
// subscribes mid-prompt (F5, second tab) must receive the pending
// approval_request / question_request again, after snapshot + replay_done.

afterEach(() => {
  setHandlerDeps(null);
});

function sessionRow(sessionId: string): Record<string, unknown> {
  return {
    id: sessionId,
    userId: 'alice',
    workDir: '/tmp/replay-test',
    sdkSessionId: null,
    totalTokens: 0,
    totalCostUsd: '0',
    title: null,
    pendingPrompt: null,
    pendingEnqueuedAt: null,
    thinking: true,
    approvalMode: 'ask',
    effort: null,
  };
}

async function subscribe(ws: FakeWS, sessionId: string): Promise<void> {
  await handleMessage(asWS(ws), JSON.stringify({ type: 'subscribe', payload: { sessionId } }));
}

describe('pending prompt replay on attach', () => {
  it('re-sends pending question_request and approval_request after the snapshot', async () => {
    const manager = new SessionManager();
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const sessionId = 'sess-replay-1';
    const active = manager.register({
      sessionId,
      userId: 'alice',
      workDir: '/tmp/replay-test',
    });

    const questionPayload: QuestionRequestPayload = {
      id: 'toolu_q1',
      requestId: 'req-q1',
      questions: [{ question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    };
    active.pendingQuestions.set('req-q1', {
      requestId: 'req-q1',
      payload: questionPayload,
      resolve: () => {},
    });
    const approvalPayload: ApprovalRequestPayload = {
      id: 'toolu_a1',
      requestId: 'req-a1',
      action: 'Bash',
      description: 'Bash: rm -rf /tmp/x',
      command: 'rm -rf /tmp/x',
    };
    active.pendingApprovals.set('req-a1', {
      requestId: 'req-a1',
      payload: approvalPayload,
      resolve: () => {},
    });

    fake.selectQueue.push([sessionRow(sessionId)]);
    const ws = new FakeWS('alice');
    await subscribe(ws, sessionId);

    const types = ws.parsed().map((m) => m.type);
    expect(types).toEqual(['snapshot', 'replay_done', 'approval_request', 'question_request']);

    const question = ws.parsed().find((m) => m.type === 'question_request');
    expect(question?.payload).toEqual(questionPayload);
    expect(question?.sessionId).toBe(sessionId);

    const approval = ws.parsed().find((m) => m.type === 'approval_request');
    expect(approval?.payload).toEqual(approvalPayload);
  });

  it('replays nothing when no prompts are pending', async () => {
    const manager = new SessionManager();
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const sessionId = 'sess-replay-2';
    manager.register({ sessionId, userId: 'alice', workDir: '/tmp/replay-test' });

    fake.selectQueue.push([sessionRow(sessionId)]);
    const ws = new FakeWS('alice');
    await subscribe(ws, sessionId);

    const types = ws.parsed().map((m) => m.type);
    expect(types).toEqual(['snapshot', 'replay_done']);
  });
});
