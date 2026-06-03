import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Single-consumer push queue bridging WebSocket input into the SDK's
 * `query({ prompt })` stream. The SDK pulls one `SDKUserMessage` at a time via
 * `iterable`; `push` either hands the message to a waiting consumer or buffers
 * it, and `close` ends iteration.
 */
export function createMessageBridge(sessionId: string) {
  const queue: SDKUserMessage[] = [];
  let resolve: ((msg: SDKUserMessage | null) => void) | null = null;
  let done = false;

  const iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (done) return { done: true as const, value: undefined };
          if (queue.length > 0)
            return { done: false as const, value: queue.shift() as SDKUserMessage };
          const msg = await new Promise<SDKUserMessage | null>((r) => {
            resolve = r;
          });
          if (done || msg === null) return { done: true as const, value: undefined };
          return { done: false as const, value: msg };
        },
        async return() {
          done = true;
          return { done: true as const, value: undefined };
        },
      };
    },
  };

  function push(content: string) {
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
    if (resolve) {
      const r = resolve;
      resolve = null;
      r(msg);
    } else {
      queue.push(msg);
    }
  }

  function close() {
    done = true;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r(null);
    }
  }

  return { iterable, push, close };
}

export type MessageBridge = ReturnType<typeof createMessageBridge>;
