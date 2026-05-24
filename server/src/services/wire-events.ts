import { parseEventPayload, type StreamEvent } from '@moonshot-ai/kimi-agent-sdk';

type WireEvent = StreamEvent;

import type { Block, DisplayBlock, QuestionItemDTO } from 'shared/types';
import { logger } from '../lib/logger';

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
  partialToolCallArgs: Map<string, string>;
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
      const parsed = parseEventPayload(type, payload);
      if (!parsed.ok) {
        logger.warn(`Failed to parse wire event payload: ${parsed.error}`);
        continue;
      }
      events.push({
        type: parsed.value.type,
        payload: parsed.value.payload,
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

  const toolCallsInTurn = new Map<
    string,
    { name: string; hasResult: boolean; createdAt: string }
  >();

  interface SubagentState {
    block: any;
    nested: (WireEvent & { timestamp: string })[];
  }
  const subagentBlocksByParent = new Map<string, SubagentState>();

  const flush = (timestamp: string, isStreaming = false) => {
    if (thinkBuf) {
      blocks.push({
        kind: 'thinking',
        id: `thinking:${turnIdx}:${stepIdx}`,
        turnIdx,
        stepIdx,
        content: thinkBuf,
        encrypted: thinkEncrypted,
        isStreaming,
        createdAt: timestamp,
      });
      thinkBuf = '';
      thinkEncrypted = false;
    }
    if (textBuf) {
      blocks.push({
        kind: 'text',
        id: `text:${turnIdx}:${stepIdx}`,
        turnIdx,
        stepIdx,
        content: textBuf,
        isStreaming,
        createdAt: timestamp,
      });
      textBuf = '';
    }
  };

  for (const ev of events) {
    const timestamp = ev.timestamp;

    switch (ev.type) {
      case 'TurnBegin': {
        flush(timestamp);
        turnIdx++;
        stepIdx = 0;
        toolCallsInTurn.clear();

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
          const parsed = parseEventPayload(rawEvent.type, rawEvent.payload);
          if (parsed.ok) {
            subState.nested.push({
              type: parsed.value.type,
              payload: parsed.value.payload,
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
        const thinkId = `thinking:${overlay.liveTurnIdx}:${overlay.liveStepIdx}`;
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
            content: overlay.liveThinkingDelta,
            encrypted: false,
            isStreaming: true,
            createdAt: new Date().toISOString(),
          });
        }
      }
      if (overlay.liveTextDelta) {
        const textId = `text:${overlay.liveTurnIdx}:${overlay.liveStepIdx}`;
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
            content: overlay.liveTextDelta,
            isStreaming: true,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    for (const [tcId, argsPart] of overlay.partialToolCallArgs.entries()) {
      const tcBlock = blocks.find((b) => b.kind === 'tool_call' && b.toolCallId === tcId);
      if (tcBlock && tcBlock.kind === 'tool_call') {
        tcBlock.argsStreaming = argsPart;
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
          questions: qReq.questions,
          createdAt: new Date().toISOString(),
        });
      }
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
