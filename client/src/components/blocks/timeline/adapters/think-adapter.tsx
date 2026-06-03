import { ThoughtCard } from '../thought-card';
import type { Adapter, RailRowShape, ThinkingBlock } from '../types';
import { readArgString, statusOf } from '../types';

// Thought rows intentionally skip a verb-icon — the brain icon now lives in
// the rail's collapse header instead, and the row's status dot is enough to
// anchor it on the rail line.
const THOUGHT_DOT = <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />;

/** ToolCall named "Think" — args.thought carries the content. */
export const ThinkToolAdapter: Adapter = (ctx) => {
  const thought =
    readArgString(ctx.call, 'thought') ||
    readArgString(ctx.call, 'reasoning') ||
    readArgString(ctx.call, 'content');
  return {
    icon: THOUGHT_DOT,
    verb: 'Thought',
    detail: thought ? (
      <ThoughtCard content={thought} isStreaming={ctx.call.isStreaming} />
    ) : undefined,
    status: statusOf(ctx),
  };
};

/** Helper: build a RailRowShape directly from a transparent thinking Block. */
export function thinkingBlockToRow(b: ThinkingBlock): RailRowShape {
  return {
    icon: THOUGHT_DOT,
    verb: 'Thought',
    detail: <ThoughtCard content={b.content} encrypted={b.encrypted} isStreaming={b.isStreaming} />,
    status: b.isStreaming ? 'running' : 'ok',
  };
}
