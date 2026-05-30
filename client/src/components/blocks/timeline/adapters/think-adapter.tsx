import { ThoughtCard } from '../thought-card';
import type { RailRowShape, ThinkingBlock } from '../types';

// Thought rows intentionally skip a verb-icon — the brain icon now lives in
// the rail's collapse header instead, and the row's status dot is enough to
// anchor it on the rail line.
const THOUGHT_DOT = <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />;

/**
 * Build a RailRowShape directly from a native thinking Block. Claude emits
 * reasoning as `thinking` blocks (not a `Think` tool call), so there is no
 * tool-call adapter — the rail renders thinking blocks through this helper.
 */
export function thinkingBlockToRow(b: ThinkingBlock): RailRowShape {
  return {
    icon: THOUGHT_DOT,
    verb: 'Thought',
    detail: <ThoughtCard content={b.content} encrypted={b.encrypted} isStreaming={b.isStreaming} />,
    status: b.isStreaming ? 'running' : 'ok',
  };
}
