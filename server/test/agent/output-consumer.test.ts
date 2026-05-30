import { describe, expect, it, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/session-manager';

// The consumer's only external emit path is broadcastEvent — capture it.
type Broadcast = { type: string; payload: { id?: string; final?: boolean } };
const broadcasts: Broadcast[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload: payload as Broadcast['payload'] });
    return { type, payload };
  },
}));

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
    // no session_id so captureSessionId stays a no-op (no DB / transcript writes).
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
