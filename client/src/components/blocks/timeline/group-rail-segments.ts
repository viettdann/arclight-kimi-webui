import type { Block } from 'shared/types';
import { isRailEligible } from './activity-timeline';
import type { RailBlock } from './types';

/** A run of consecutive rail-eligible blocks, or any other item rendered as-is. */
export type RailSegment<T = Block> =
  | { kind: 'rail'; id: string; items: RailBlock[] }
  | { kind: 'item'; id: string; item: T };

/**
 * Walk an item list, batch consecutive rail-eligible items into rail segments,
 * pass everything else through as standalone segments preserving order.
 *
 * @param items source list
 * @param toRail returns the underlying RailBlock if `item` belongs on the rail,
 *               otherwise null. For raw Block[] callers this is just
 *               `(b) => isRailEligible(b) ? b : null`.
 * @param keyOf stable id for a non-rail item (used as segment key).
 */
export function groupRail<T>(
  items: T[],
  toRail: (item: T) => RailBlock | null,
  keyOf: (item: T) => string,
): RailSegment<T>[] {
  const out: RailSegment<T>[] = [];
  let buffer: RailBlock[] = [];

  const flush = () => {
    const first = buffer[0];
    if (!first) return;
    out.push({ kind: 'rail', id: `rail:${first.id}`, items: buffer });
    buffer = [];
  };

  for (const it of items) {
    const rail = toRail(it);
    if (rail) {
      buffer.push(rail);
      continue;
    }
    flush();
    out.push({ kind: 'item', id: keyOf(it), item: it });
  }
  flush();

  return out;
}

/** Convenience: group raw Block[] (used inside SubagentBundle). */
export function groupRailSegments(blocks: Block[]): RailSegment<Block>[] {
  return groupRail(
    blocks,
    (b) => (isRailEligible(b) ? b : null),
    (b) => b.id,
  );
}
