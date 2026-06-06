// Shared snake_case → camelCase mapping for the SDK task usage object. Two
// variants: the typed `mapTaskUsage` (live consumer — the wire shape is known)
// and the tolerant `mapTaskUsageSafe` (reload renderer — input is an untrusted
// JSONL value). Kept in one place so the two paths can't drift.

import type { TaskUsage } from 'shared/types';

/** Subset of the SDK task usage object (snake_case wire shape). */
export interface SdkTaskUsageLike {
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
}

/** Map the SDK snake_case task usage onto the camelCase wire {@link TaskUsage}. */
export function mapTaskUsage(usage: SdkTaskUsageLike): TaskUsage {
  return {
    totalTokens: usage.total_tokens,
    toolUses: usage.tool_uses,
    durationMs: usage.duration_ms,
  };
}

/**
 * Tolerant variant of {@link mapTaskUsage} for untrusted/persisted input.
 * Returns undefined when the value is absent or malformed; numeric fields
 * default to 0 when missing.
 */
export function mapTaskUsageSafe(v: unknown): TaskUsage | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const rec = v as Record<string, unknown>;
  const totalTokens = typeof rec.total_tokens === 'number' ? rec.total_tokens : 0;
  const toolUses = typeof rec.tool_uses === 'number' ? rec.tool_uses : 0;
  const durationMs = typeof rec.duration_ms === 'number' ? rec.duration_ms : 0;
  return { totalTokens, toolUses, durationMs };
}
