import type { ReactNode } from 'react';
import type { Block } from 'shared/types';

export type ToolCallBlock = Extract<Block, { kind: 'tool_call' }>;
export type ToolResultBlock = Extract<Block, { kind: 'tool_result' }>;
export type ThinkingBlock = Extract<Block, { kind: 'thinking' }>;
export type ErrorRailBlock = Extract<Block, { kind: 'error' }>;
export type ApprovalRailBlock = Extract<Block, { kind: 'approval_request' }>;

export type RailBlock =
  | ThinkingBlock
  | ToolCallBlock
  | ToolResultBlock
  | ErrorRailBlock
  | ApprovalRailBlock;

/** Status of a single rail row. Drives icon color + tail badge. */
export type RailRowStatus = 'running' | 'ok' | 'error' | 'interrupted';

/** What a tool adapter returns — used by TimelineRow to render. */
export interface RailRowShape {
  icon: ReactNode;
  /** Imperative verb, e.g. "Read", "Edited 1 file". */
  verb: string;
  /** Muted subject inline next to the verb (filename, command, glob, …). */
  inline?: ReactNode;
  /** Inline marker rendered after `inline` on the same row (e.g. approval badge). */
  badge?: ReactNode;
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
  // SDK streams tool args as head (ToolCall.arguments) + tail
  // (ToolCallPart.arguments_part stored in argsStreaming). Either piece alone
  // is rarely valid JSON — concatenate before parsing, then fall back to
  // best-effort completion of a still-streaming head.
  const head = typeof args === 'string' ? args : '';
  const tail = call.argsStreaming || '';
  const candidates: string[] = [];
  if (head || tail) candidates.push(head + tail);
  if (head && !tail) candidates.push(completePartialJson(head));
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Best-effort close of a JSON object that was cut mid-stream. Keeps the
 * last complete string property so adapters can still show e.g. the file
 * path while later chunks are in flight. Does not attempt to recover
 * partially-typed string values.
 */
function completePartialJson(s: string): string {
  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 1) lastSafe = i;
  }
  if (inStr || depth !== 1 || lastSafe === -1) return '';
  return `${s.slice(0, lastSafe)}}`;
}

/**
 * Status derived from call/result pair. Result presence wins over
 * `call.isStreaming` so a late `tool_call_delta` can't re-arm the spinner
 * after the result has already arrived.
 */
export function statusOf(ctx: AdapterContext): RailRowStatus {
  if (ctx.result?.synthetic === 'interrupted') return 'interrupted';
  if (ctx.result?.isError) return 'error';
  if (ctx.result != null) return 'ok';
  return 'running';
}
