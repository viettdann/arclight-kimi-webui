import { describe, expect, it, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/session-manager';

// The consumer's only external emit path is broadcastEvent — capture it.
type Broadcast = { type: string; payload: Record<string, unknown> };
const broadcasts: Broadcast[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload: (payload ?? {}) as Record<string, unknown> });
    return { type, payload };
  },
}));

// Transcript persistence now belongs to the SDK store mirror, not the consumer.
// The consumer only ever writes the `sessions` row (sdkSessionId / usage / title)
// and reads the title row back. Title stays `manual` so `maybePersistTitle`
// short-circuits, keeping these tests about the live emit path.
const dbFactory = () => ({
  db: {
    query: {
      sessions: { findFirst: async () => ({ title: 'preset', titleSource: 'manual' }) },
    },
    update: () => ({
      set: () => ({ where: async () => {} }),
    }),
  },
  schema: { sessions: {} },
});
mock.module('../../src/db', dbFactory);
mock.module('../../src/db/index', dbFactory);

const { consumeQueryOutput } = await import('../../src/services/agent/output-consumer');
const { SessionManager } = await import('../../src/services/session-manager');

/** An async-iterable query that just replays a fixed message list. */
function makeQuery(messages: unknown[]): ActiveSession['query'] {
  return (async function* () {
    for (const m of messages) yield m;
  })() as unknown as ActiveSession['query'];
}

describe('consumeQueryOutput — assistant content-block id parity', () => {
  it('assigns CUMULATIVE block ids across same-message-id split messages', async () => {
    // Verified via live SDK probe: the SDK emits each content block as its OWN
    // length-1 `assistant` message; consecutive blocks share one message.id and
    // the true block index is the order within that same-id group. Messages carry
    // no session_id so captureSessionId stays a no-op (no DB writes).
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's1',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    const A = 'msg_AAA';
    const B = 'msg_BBB';
    active.query = makeQuery([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: A, content: [{ type: 'thinking', thinking: 'reason', signature: '' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: A, content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: A,
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } },
          ],
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: B, content: [{ type: 'thinking', thinking: 'more', signature: '' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: B, content: [{ type: 'text', text: 'final' }] },
      },
    ]);

    await consumeQueryOutput(active);

    // Block ids increment per content block within a message.id and reset on a new
    // id — matching the streaming event.index and the reload renderer. The old bug
    // used the (always-0) array-local index, so text collided onto `${A}:0`.
    expect(
      broadcasts.map((b) => ({ type: b.type, id: b.payload.id, final: b.payload.final })),
    ).toEqual([
      { type: 'thinking_delta', id: `${A}:0`, final: true },
      { type: 'text_delta', id: `${A}:1`, final: true },
      { type: 'tool_call', id: 'toolu_1', final: undefined },
      { type: 'thinking_delta', id: `${B}:0`, final: true },
      { type: 'text_delta', id: `${B}:1`, final: true },
    ]);
  });
});

describe('consumeQueryOutput — API limit / failure surfacing', () => {
  it('emits a structured error block for an assistant-level API error (no text_delta)', async () => {
    // A rejected API request surfaces as an assistant message whose `error`
    // field carries the SDK classification and whose text is the readable
    // detail. The consumer must emit ONE error block, not stream the text.
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's-api-err',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    const detail = 'API Error: Request rejected (429) · You have exceeded the 5-hour usage quota.';
    active.query = makeQuery([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'rate_limit',
        message: { id: 'msg_E', content: [{ type: 'text', text: detail }] },
      },
    ]);

    await consumeQueryOutput(active);

    expect(broadcasts.filter((b) => b.type === 'text_delta')).toEqual([]);
    const errs = broadcasts.filter((b) => b.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]?.payload.code).toBe('rate_limit');
    expect(errs[0]?.payload.message).toBe(detail);
    expect(errs[0]?.payload.retryable).toBe(true);
  });

  it('mirrors rate_limit_event as a rate_limit broadcast', async () => {
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's-rl',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    active.query = makeQuery([
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed_warning',
          resetsAt: 1764864000,
          rateLimitType: 'five_hour',
          utilization: 87,
        },
        uuid: 'u-rl',
        session_id: 'sdk-rl',
      },
    ]);

    await consumeQueryOutput(active);

    const rl = broadcasts.find((b) => b.type === 'rate_limit');
    expect(rl?.payload).toEqual({
      status: 'allowed_warning',
      resetsAt: 1764864000,
      rateLimitType: 'five_hour',
      utilization: 87,
    });
  });

  it('surfaces system api_retry as an api_retry broadcast', async () => {
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's-retry',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    active.query = makeQuery([
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 8000,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'u-r',
        session_id: 'sdk-r',
      },
    ]);

    await consumeQueryOutput(active);

    const retry = broadcasts.find((b) => b.type === 'api_retry');
    expect(retry?.payload).toEqual({
      attempt: 2,
      maxRetries: 10,
      retryDelayMs: 8000,
      errorStatus: 429,
      errorCode: 'rate_limit',
    });
  });

  it('carries result errors on turn_end and emits the error block once', async () => {
    // An error result whose failure was NOT already surfaced by an
    // assistant-level error block gets its own error broadcast.
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's-res-err',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    active.query = makeQuery([
      {
        type: 'result',
        subtype: 'error_during_execution',
        num_turns: 1,
        total_cost_usd: 0,
        usage: {},
        errors: ['API Error: Request rejected (429)'],
      },
    ]);

    await consumeQueryOutput(active);

    const turnEnd = broadcasts.find((b) => b.type === 'turn_end');
    expect(turnEnd?.payload.status).toBe('error');
    expect(turnEnd?.payload.errors).toEqual(['API Error: Request rejected (429)']);
    const errs = broadcasts.filter((b) => b.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]?.payload.code).toBe('error_during_execution');
  });

  it('does NOT duplicate the error block when the assistant already surfaced it', async () => {
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's-no-dup',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    const detail = 'API Error: Request rejected (429) · quota exceeded';
    active.query = makeQuery([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'rate_limit',
        message: { id: 'msg_D', content: [{ type: 'text', text: detail }] },
      },
      {
        type: 'result',
        subtype: 'error_during_execution',
        num_turns: 1,
        total_cost_usd: 0,
        usage: {},
        errors: [detail],
      },
    ]);

    await consumeQueryOutput(active);

    const errs = broadcasts.filter((b) => b.type === 'error');
    expect(errs).toHaveLength(1); // the assistant-level block only
    expect(errs[0]?.payload.code).toBe('rate_limit');
    const turnEnd = broadcasts.find((b) => b.type === 'turn_end');
    expect(turnEnd?.payload.errors).toEqual([detail]);
  });
});

describe('consumeQueryOutput — store mirror_error surfacing', () => {
  it('broadcasts a non-retryable error when the SDK reports a mirror_error', async () => {
    // The SDK store `append()` exhausted its retries and dropped a transcript
    // batch. The subprocess is unaffected and the turn continues; the consumer
    // surfaces it (no auto-repair) so a silently-incomplete DB store is visible.
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's-mirror',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    active.query = makeQuery([
      {
        type: 'system',
        subtype: 'mirror_error',
        error: 'append failed after retries',
        key: { projectKey: 'pk', sessionId: 'sdk-mirror' },
        uuid: 'u-1',
        session_id: 'sdk-mirror',
      },
    ]);

    await consumeQueryOutput(active);

    const err = broadcasts.find((b) => b.type === 'error');
    expect(err).toBeDefined();
    expect(err?.payload.code).toBe('mirror_error');
    expect(err?.payload.retryable).toBe(false);
    expect(typeof err?.payload.message).toBe('string');
  });
});
