// biome-ignore-all lint/suspicious/noExplicitAny: bridges runtime-validated SDK wire payloads (incl. request-types outside the StreamEvent union) to block shapes
import {
  parseEventPayload,
  parseRequestPayload,
  type StreamEvent,
} from '@moonshot-ai/kimi-agent-sdk';

type WireEvent = StreamEvent;

import type { Block, DisplayBlock, QuestionItemDTO } from 'shared/types';
import { logger } from '../lib/logger';

// Wire-only types that ride alongside StreamEvent but live in RequestSchemas,
// not EventSchemas. SDK still writes them to wire.jsonl, so the replay parser
// must accept them or the snapshot drops pending approvals/questions.
const REQUEST_TYPES_IN_WIRE = new Set([
  'ApprovalRequest',
  'QuestionRequest',
  'ToolCallRequest',
  'HookRequest',
]);

export interface LiveOverlay {
  pendingApprovals: Map<
    string,
    { id: string; action: string; description: string; requestId: string }
  >;
  pendingQuestions: Map<string, { id: string; requestId: string; questions: QuestionItemDTO[] }>;
  liveTextDelta: string;
  liveThinkingDelta: string;
  liveTurnIdx: number | null;
  liveStepIdx: number | null;
  liveThinkPartIdx: number;
  liveTextPartIdx: number;
  partialToolCallArgs: Map<string, string>;
}

/**
 * Cheaply count `TurnBegin` events in a wire-log byte string without
 * full schema validation. Used at session-restore time to seed
 * `liveTurnIdx` so the next turn's blocks don't collide with completed turns'
 * ids after a server restart or in-memory cache miss.
 */
export function countTurnBeginsInWireBytes(bytes: string): number {
  if (!bytes) return 0;
  let count = 0;
  const lines = bytes.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes('"TurnBegin"')) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec?.message?.type === 'TurnBegin') count++;
    } catch {
      // Skip malformed lines — same tolerance as parseWireFromBytes.
    }
  }
  return count;
}

export function parseWireFromBytes(bytes: string): (WireEvent & { timestamp: string })[] {
  const events: (WireEvent & { timestamp: string })[] = [];
  const lines = bytes.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (!rec.message) continue;
      const type = rec.message.type;
      const payload = rec.message.payload;
      let resolvedType: string;
      let resolvedPayload: unknown;
      const parsed = parseEventPayload(type, payload);
      if (parsed.ok) {
        resolvedType = parsed.value.type;
        resolvedPayload = parsed.value.payload;
      } else if (REQUEST_TYPES_IN_WIRE.has(type)) {
        const reqParsed = parseRequestPayload(type, payload);
        if (!reqParsed.ok) {
          logger.warn(`Failed to parse wire request payload: ${reqParsed.error}`);
          continue;
        }
        resolvedType = reqParsed.value.type;
        resolvedPayload = reqParsed.value.payload;
      } else {
        logger.warn(`Failed to parse wire event payload: ${parsed.error}`);
        continue;
      }
      events.push({
        type: resolvedType,
        payload: resolvedPayload,
        timestamp: rec.timestamp || new Date().toISOString(),
      } as any);
    } catch (err) {
      logger.warn(`Malformed wire JSONL line skipped: ${err}`);
    }
  }
  return events;
}

export function wireEventsToBlocks(
  events: (WireEvent & { timestamp: string })[],
  opts?: { overlay?: LiveOverlay | null },
): Block[] {
  const blocks: Block[] = [];

  let turnIdx = -1;
  let stepIdx = 0;
  let textBuf = '';
  let thinkBuf = '';
  let thinkEncrypted = false;
  let steerCount = 0;
  // partIdx counters disambiguate multiple think/text segments within a single
  // (turn, step) — e.g. two `think` ContentParts separated by a tool_call.
  // Reset on TurnBegin / StepBegin. Incremented after each block push.
  let thinkPartIdx = 0;
  let textPartIdx = 0;

  const toolCallsInTurn = new Map<
    string,
    { name: string; hasResult: boolean; createdAt: string }
  >();
  // SDK omits the id on ToolCallPart; it implicitly targets the most recent
  // ToolCall on the wire.
  let lastToolCallId: string | null = null;

  interface SubagentState {
    block: any;
    nested: (WireEvent & { timestamp: string })[];
  }
  const subagentBlocksByParent = new Map<string, SubagentState>();

  const flush = (timestamp: string, isStreaming = false) => {
    if (thinkBuf) {
      blocks.push({
        kind: 'thinking',
        id: `thinking:${turnIdx}:${stepIdx}:${thinkPartIdx}`,
        turnIdx,
        stepIdx,
        partIdx: thinkPartIdx,
        content: thinkBuf,
        encrypted: thinkEncrypted,
        isStreaming,
        createdAt: timestamp,
      });
      thinkBuf = '';
      thinkEncrypted = false;
      thinkPartIdx++;
    }
    if (textBuf) {
      blocks.push({
        kind: 'text',
        id: `text:${turnIdx}:${stepIdx}:${textPartIdx}`,
        turnIdx,
        stepIdx,
        partIdx: textPartIdx,
        content: textBuf,
        isStreaming,
        createdAt: timestamp,
      });
      textBuf = '';
      textPartIdx++;
    }
  };

  for (const ev of events) {
    const timestamp = ev.timestamp;

    switch (ev.type) {
      case 'TurnBegin': {
        flush(timestamp);
        turnIdx++;
        stepIdx = 0;
        thinkPartIdx = 0;
        textPartIdx = 0;
        toolCallsInTurn.clear();
        lastToolCallId = null;

        const content = contentPartsToText(ev.payload.user_input);
        blocks.push({
          kind: 'user',
          id: `user:wire:${turnIdx}`,
          content,
          createdAt: timestamp,
          status: 'sent',
        });
        break;
      }

      case 'StepBegin': {
        flush(timestamp);
        stepIdx = ev.payload.n;
        thinkPartIdx = 0;
        textPartIdx = 0;
        break;
      }

      case 'StepInterrupted': {
        flush(timestamp);
        break;
      }

      case 'ContentPart': {
        const part = ev.payload as any;
        if (part.type === 'text') {
          textBuf += part.text;
        } else if (part.type === 'think') {
          thinkBuf += part.think;
          if (part.encrypted) {
            thinkEncrypted = true;
          }
        }
        break;
      }

      case 'ToolCall': {
        flush(timestamp);
        const tc = ev.payload as any;
        lastToolCallId = tc.id;
        blocks.push({
          kind: 'tool_call',
          id: `tool_call:${tc.id}`,
          toolCallId: tc.id,
          name: tc.function.name,
          args: tc.function.arguments || {},
          isStreaming: false,
          createdAt: timestamp,
        });
        toolCallsInTurn.set(tc.id, {
          name: tc.function.name,
          hasResult: false,
          createdAt: timestamp,
        });
        break;
      }

      case 'ToolCallPart': {
        // SDK streams long tool-call arguments as ToolCall (head) + a series
        // of ToolCallPart (tails). The implicit id is the most recent
        // ToolCall. Append into args so post-reload blocks contain the full
        // JSON — otherwise adapters parse a truncated head and lose path /
        // command / etc.
        const partPayload = ev.payload as any;
        const tcId = partPayload.id ?? lastToolCallId;
        if (!tcId) break;
        const part = partPayload.arguments_part ?? '';
        if (!part) break;
        const tcBlock = blocks.find((b) => b.kind === 'tool_call' && b.toolCallId === tcId) as
          | Extract<Block, { kind: 'tool_call' }>
          | undefined;
        if (tcBlock) {
          const head = typeof tcBlock.args === 'string' ? tcBlock.args : '';
          tcBlock.args = head + part;
        }
        break;
      }

      case 'ToolResult': {
        flush(timestamp);
        const tr = ev.payload as any;
        const rv = tr.return_value as any;
        blocks.push({
          kind: 'tool_result',
          id: `tool_result:${tr.tool_call_id}`,
          toolCallId: tr.tool_call_id,
          toolName: toolCallsInTurn.get(tr.tool_call_id)?.name || '',
          output: rv.output,
          message: rv.message || null,
          displayBlocks: mapDisplayBlocks(rv.display),
          isError: rv.is_error,
          createdAt: timestamp,
        });

        const tcState = toolCallsInTurn.get(tr.tool_call_id);
        if (tcState) {
          tcState.hasResult = true;
        }
        break;
      }

      case 'SubagentEvent': {
        const payload = ev.payload as any;
        const parentToolCallId = payload.parent_tool_call_id;
        const rawEvent = payload.event as any;

        let subState = subagentBlocksByParent.get(parentToolCallId);
        if (!subState) {
          const subBlock: Block = {
            kind: 'subagent',
            id: `subagent:${parentToolCallId}`,
            parentToolCallId,
            blocks: [],
            isStreaming: true,
            createdAt: timestamp,
          };
          const idx = blocks.findIndex(
            (b) => b.kind === 'tool_call' && b.toolCallId === parentToolCallId,
          );
          if (idx !== -1) {
            blocks.splice(idx + 1, 0, subBlock);
          } else {
            blocks.push(subBlock);
          }
          subState = { block: subBlock, nested: [] };
          subagentBlocksByParent.set(parentToolCallId, subState);
        }

        if (rawEvent && typeof rawEvent === 'object') {
          const rawType = (rawEvent as any).type;
          let resolved: { type: string; payload: unknown } | null = null;
          const parsed = parseEventPayload(rawType, (rawEvent as any).payload);
          if (parsed.ok) {
            resolved = { type: parsed.value.type, payload: parsed.value.payload };
          } else if (REQUEST_TYPES_IN_WIRE.has(rawType)) {
            const reqParsed = parseRequestPayload(rawType, (rawEvent as any).payload);
            if (reqParsed.ok) {
              resolved = { type: reqParsed.value.type, payload: reqParsed.value.payload };
            }
          }
          if (resolved) {
            subState.nested.push({
              type: resolved.type,
              payload: resolved.payload,
              timestamp: (rawEvent as any).timestamp || timestamp,
            } as any);
            subState.block.blocks = wireEventsToBlocks(subState.nested, opts);
          }
        }
        break;
      }

      case 'SteerInput': {
        flush(timestamp);
        const content = contentPartsToText((ev.payload as any).user_input);
        blocks.push({
          kind: 'steer',
          id: `steer:${steerCount++}`,
          content,
          createdAt: timestamp,
        });
        break;
      }

      case 'ApprovalRequest': {
        flush(timestamp);
        const payload = ev.payload as any;
        if (!blocks.some((b) => b.kind === 'approval_request' && b.requestId === payload.id)) {
          blocks.push({
            kind: 'approval_request',
            id: `approval:${payload.id}`,
            requestId: payload.id,
            toolCallId: payload.tool_call_id,
            action: payload.action,
            description: payload.description,
            createdAt: timestamp,
          });
        }
        break;
      }

      case 'QuestionRequest': {
        flush(timestamp);
        const payload = ev.payload as any;
        if (!blocks.some((b) => b.kind === 'question_request' && b.requestId === payload.id)) {
          const questions: QuestionItemDTO[] = (payload.questions || []).map((q: any) => ({
            question: q.question,
            ...(q.header != null ? { header: q.header } : {}),
            options: (q.options || []).map((o: any) => ({
              label: o.label,
              ...(o.description != null ? { description: o.description } : {}),
            })),
            ...(q.multi_select != null ? { multiSelect: q.multi_select } : {}),
          }));
          blocks.push({
            kind: 'question_request',
            id: `question:${payload.id}`,
            requestId: payload.id,
            toolCallId: payload.tool_call_id,
            questions,
            createdAt: timestamp,
          });
        }
        break;
      }

      case 'ApprovalResponse': {
        const payload = ev.payload as any;
        const reqBlock = blocks.find(
          (b) => b.kind === 'approval_request' && b.requestId === payload.id,
        );
        if (reqBlock && reqBlock.kind === 'approval_request') {
          reqBlock.resolution = payload.response as any;
        }
        break;
      }

      case 'TurnEnd': {
        flush(timestamp);
        for (const subState of subagentBlocksByParent.values()) {
          subState.block.isStreaming = false;
        }
        for (const [tcId, tcState] of toolCallsInTurn.entries()) {
          if (!tcState.hasResult) {
            blocks.push({
              kind: 'tool_result',
              id: `tool_result:${tcId}:orphan`,
              toolCallId: tcId,
              toolName: tcState.name,
              output: null,
              message: 'Interrupted',
              displayBlocks: [],
              isError: true,
              synthetic: 'interrupted',
              createdAt: timestamp,
            });
            tcState.hasResult = true;
          }
        }
        break;
      }

      default:
        break;
    }
  }

  flush(events[events.length - 1]?.timestamp || new Date().toISOString(), !!opts?.overlay);

  for (const subState of subagentBlocksByParent.values()) {
    subState.block.isStreaming = false;
  }
  for (const [tcId, tcState] of toolCallsInTurn.entries()) {
    if (!tcState.hasResult) {
      const lastTs = events[events.length - 1]?.timestamp || new Date().toISOString();
      blocks.push({
        kind: 'tool_result',
        id: `tool_result:${tcId}:orphan`,
        toolCallId: tcId,
        toolName: tcState.name,
        output: null,
        message: 'Interrupted',
        displayBlocks: [],
        isError: true,
        synthetic: 'interrupted',
        createdAt: lastTs,
      });
      tcState.hasResult = true;
    }
  }

  if (opts?.overlay) {
    const overlay = opts.overlay;
    if (overlay.liveTurnIdx !== null && overlay.liveStepIdx !== null) {
      if (overlay.liveThinkingDelta) {
        const thinkId = `thinking:${overlay.liveTurnIdx}:${overlay.liveStepIdx}:${overlay.liveThinkPartIdx}`;
        const thinkBlock = blocks.find((b) => b.kind === 'thinking' && b.id === thinkId);
        if (thinkBlock && thinkBlock.kind === 'thinking') {
          thinkBlock.content = overlay.liveThinkingDelta;
          thinkBlock.isStreaming = true;
        } else {
          blocks.push({
            kind: 'thinking',
            id: thinkId,
            turnIdx: overlay.liveTurnIdx,
            stepIdx: overlay.liveStepIdx,
            partIdx: overlay.liveThinkPartIdx,
            content: overlay.liveThinkingDelta,
            encrypted: false,
            isStreaming: true,
            createdAt: new Date().toISOString(),
          });
        }
      }
      if (overlay.liveTextDelta) {
        const textId = `text:${overlay.liveTurnIdx}:${overlay.liveStepIdx}:${overlay.liveTextPartIdx}`;
        const textBlock = blocks.find((b) => b.kind === 'text' && b.id === textId);
        if (textBlock && textBlock.kind === 'text') {
          textBlock.content = overlay.liveTextDelta;
          textBlock.isStreaming = true;
        } else {
          blocks.push({
            kind: 'text',
            id: textId,
            turnIdx: overlay.liveTurnIdx,
            stepIdx: overlay.liveStepIdx,
            partIdx: overlay.liveTextPartIdx,
            content: overlay.liveTextDelta,
            isStreaming: true,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    for (const [tcId, overlayPart] of overlay.partialToolCallArgs.entries()) {
      const tcBlock = blocks.find((b) => b.kind === 'tool_call' && b.toolCallId === tcId);
      if (tcBlock && tcBlock.kind === 'tool_call') {
        // Overlay tracks the running concat of ToolCallPart.arguments_part for
        // the in-flight tool call. The ToolCall case above already merged any
        // ToolCallPart events that made it into wire bytes into `args`. The
        // overlay may legitimately hold *more* than wire (events flushed in
        // memory but not yet appended to wire.jsonl) — in that case extend
        // `args` with the unseen suffix. Setting `argsStreaming` here would
        // double-append on the client since parseArgs concatenates head+tail.
        if (typeof tcBlock.args === 'string' && overlayPart) {
          const head = tcBlock.args;
          // Try to find the longest suffix of head that is a prefix of
          // overlayPart — that's the overlap. Anything past it is new.
          const maxOverlap = Math.min(head.length, overlayPart.length);
          let overlap = 0;
          for (let len = maxOverlap; len > 0; len--) {
            if (head.endsWith(overlayPart.slice(0, len))) {
              overlap = len;
              break;
            }
          }
          const suffix = overlayPart.slice(overlap);
          if (suffix) tcBlock.args = head + suffix;
        }
        tcBlock.isStreaming = true;
      }
    }

    for (const appReq of overlay.pendingApprovals.values()) {
      if (!blocks.some((b) => b.kind === 'approval_request' && b.requestId === appReq.requestId)) {
        blocks.push({
          kind: 'approval_request',
          id: `approval:${appReq.requestId}`,
          requestId: appReq.requestId,
          toolCallId: appReq.id,
          action: appReq.action,
          description: appReq.description,
          createdAt: new Date().toISOString(),
        });
      }
    }

    for (const qReq of overlay.pendingQuestions.values()) {
      if (!blocks.some((b) => b.kind === 'question_request' && b.requestId === qReq.requestId)) {
        blocks.push({
          kind: 'question_request',
          id: `question:${qReq.requestId}`,
          requestId: qReq.requestId,
          toolCallId: qReq.id,
          questions: qReq.questions,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // Mark `question_request` blocks as resolved when their AskUserQuestion
  // tool_call has produced a non-synthetic tool_result. The wire format has
  // no explicit QuestionResponse event, so the matching tool_result is our
  // resolved signal. Synthetic interrupted results don't count — they mean
  // the question was abandoned, not answered.
  const resolvedToolCallIds = new Set<string>();
  for (const b of blocks) {
    if (b.kind === 'tool_result' && b.synthetic !== 'interrupted') {
      resolvedToolCallIds.add(b.toolCallId);
    }
  }
  if (opts?.overlay) {
    // Live pending questions are by definition unresolved — don't mark them
    // even if a stale matching tool_result somehow surfaced.
    for (const qReq of opts.overlay.pendingQuestions.values()) {
      resolvedToolCallIds.delete(qReq.id);
    }
  }
  for (const b of blocks) {
    if (b.kind === 'question_request' && b.toolCallId && resolvedToolCallIds.has(b.toolCallId)) {
      b.resolved = true;
    }
  }

  return blocks;
}

export function mapDisplayBlocks(raw: unknown): DisplayBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => {
    if (!r || typeof r !== 'object') {
      return { type: 'unknown', rawType: 'invalid', raw: r };
    }
    switch (r.type) {
      case 'shell':
        return {
          type: 'shell',
          command: r.command || '',
          language: r.language || '',
        };
      case 'diff':
        return {
          type: 'diff',
          path: r.path || '',
          oldText: r.old_text || '',
          newText: r.new_text || '',
        };
      case 'todo':
        return {
          type: 'todo',
          items: Array.isArray(r.items)
            ? r.items.map((i: any) => ({
                title: i?.title || '',
                status: i?.status || 'pending',
              }))
            : [],
        };
      case 'brief':
        return {
          type: 'brief',
          text: r.text || '',
        };
      default:
        return {
          type: 'unknown',
          rawType: r.type || 'unknown',
          raw: r.data !== undefined ? r.data : r,
        };
    }
  }) as DisplayBlock[];
}

export function contentPartsToText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input
      .map((p) => {
        if (p && typeof p === 'object' && (p as { type?: unknown }).type === 'text') {
          return String((p as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}
