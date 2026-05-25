import { Brain } from 'lucide-react';
import { ThoughtCard } from '../thought-card';
import type { Adapter, RailRowShape, ThinkingBlock } from '../types';
import { readArgString, statusOf } from '../types';

/** ToolCall named "Think" — args.thought carries the content. */
export const ThinkToolAdapter: Adapter = (ctx) => {
  const thought =
    readArgString(ctx.call, 'thought') ||
    readArgString(ctx.call, 'reasoning') ||
    readArgString(ctx.call, 'content');
  return {
    icon: <Brain className="h-3.5 w-3.5" />,
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
    icon: <Brain className="h-3.5 w-3.5" />,
    verb: 'Thought',
    detail: <ThoughtCard content={b.content} encrypted={b.encrypted} isStreaming={b.isStreaming} />,
    status: b.isStreaming ? 'running' : 'ok',
  };
}
