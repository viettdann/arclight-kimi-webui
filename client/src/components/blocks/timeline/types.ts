import type { ReactNode } from 'react';
import type { Block } from 'shared/types';

export type ToolCallBlock = Extract<Block, { kind: 'tool_call' }>;
export type ToolResultBlock = Extract<Block, { kind: 'tool_result' }>;
export type ThinkingBlock = Extract<Block, { kind: 'thinking' }>;
export type ErrorRailBlock = Extract<Block, { kind: 'error' }>;

export type RailBlock = ThinkingBlock | ToolCallBlock | ToolResultBlock | ErrorRailBlock;

/** Status of a single rail row. Drives icon color + tail badge. */
export type RailRowStatus = 'running' | 'ok' | 'error' | 'interrupted';

/** What a tool adapter returns — used by TimelineRow to render. */
export interface RailRowShape {
  icon: ReactNode;
  /** Imperative verb, e.g. "Read", "Edited 1 file". */
  verb: string;
  /** Muted subject inline next to the verb (filename, command, glob, …). */
  inline?: ReactNode;
  /** Optional indented detail under the row. */
  detail?: ReactNode;
  status: RailRowStatus;
}

/** Inputs given to a tool adapter. */
export interface AdapterContext {
  call: ToolCallBlock;
  result: ToolResultBlock | null;
}

export type Adapter = (ctx: AdapterContext) => RailRowShape;

/**
 * Args of a `tool_call` arrive as `unknown` (object after JSON.parse, or
 * partial JSON during streaming). This helper safely extracts string field.
 */
export function readArgString(call: ToolCallBlock, key: string): string {
  const obj = parseArgs(call);
  if (!obj) return '';
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

export function parseArgs(call: ToolCallBlock): Record<string, unknown> | null {
  const args = call.args;
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  const raw = typeof args === 'string' ? args : call.argsStreaming || '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // still streaming
  }
  return null;
}

/** Status derived from call/result pair. */
export function statusOf(ctx: AdapterContext): RailRowStatus {
  if (ctx.result?.synthetic === 'interrupted') return 'interrupted';
  if (ctx.result?.isError) return 'error';
  if (ctx.call.isStreaming || ctx.result == null) return 'running';
  return 'ok';
}
