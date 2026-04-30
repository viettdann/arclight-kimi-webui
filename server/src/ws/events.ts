import type { StreamEvent } from '@moonshot-ai/kimi-agent-sdk';
import type {
  ApprovalRequestPayload,
  StatusUpdatePayload,
  StepBeginPayload,
  SubagentEventPayload,
  TextDeltaPayload,
  ThinkingDeltaPayload,
  ToolCallDeltaPayload,
  ToolCallPayload,
  ToolResultPayload,
  TurnBeginPayload,
  WSMessageType,
} from 'shared/types';

// SDK's `ToolCallPart` carries no id — it is implicitly the most recent
// `ToolCall`. Translator state tracks it across the turn so we can stamp
// `tool_call_delta` payloads with the correct id. Caller resets between turns.

export interface TranslatorState {
  lastToolCallId: string | null;
}

export function createTranslatorState(): TranslatorState {
  return { lastToolCallId: null };
}

export interface TranslatedEvent<T = unknown> {
  type: WSMessageType;
  payload: T;
}

// SDK's `ContentPart` infers as `unknown` here (its bundled zod types and our
// installed zod major differ). Restate the discriminated union locally — it
// matches the wire schema verbatim.
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'think'; think: string; encrypted?: string | null }
  | { type: 'image_url'; image_url: { url: string; id?: string | null } }
  | { type: 'audio_url'; audio_url: { url: string; id?: string | null } }
  | { type: 'video_url'; video_url: { url: string; id?: string | null } };

/**
 * Map a single Kimi SDK `StreamEvent` to a WS protocol payload.
 * Returns `null` for events that have no client-facing equivalent in MVP.
 *
 * NOTE: `turn_end` is NOT emitted here — the turn iterator returns a
 * `RunResult` distinct from the `TurnEnd` wire event, so the caller emits
 * `turn_end` after `turn.result` resolves (carrying status + steps).
 */
export function translateStreamEvent(
  ev: StreamEvent,
  state: TranslatorState,
): TranslatedEvent | null {
  switch (ev.type) {
    case 'TurnBegin': {
      const payload: TurnBeginPayload = {
        userInput: contentPartsToText(ev.payload.user_input as string | ContentPart[]),
      };
      return { type: 'turn_begin', payload };
    }

    case 'StepBegin': {
      const payload: StepBeginPayload = { stepNumber: ev.payload.n };
      return { type: 'step_begin', payload };
    }

    case 'StatusUpdate': {
      const usage = ev.payload.token_usage;
      const tokenUsage = usage
        ? usage.input_other + usage.output + usage.input_cache_read + usage.input_cache_creation
        : 0;
      const payload: StatusUpdatePayload = {
        tokenUsage,
        contextUsage: ev.payload.context_usage ?? 0,
      };
      return { type: 'status_update', payload };
    }

    case 'ContentPart':
      return mapContentPart(ev.payload as ContentPart);

    case 'ToolCall': {
      state.lastToolCallId = ev.payload.id;
      const payload: ToolCallPayload = {
        id: ev.payload.id,
        name: ev.payload.function.name,
        arguments: ev.payload.function.arguments ?? null,
      };
      return { type: 'tool_call', payload };
    }

    case 'ToolCallPart': {
      if (state.lastToolCallId == null) return null;
      const payload: ToolCallDeltaPayload = {
        id: state.lastToolCallId,
        argumentsPart: ev.payload.arguments_part ?? '',
      };
      return { type: 'tool_call_delta', payload };
    }

    case 'ToolResult': {
      const rv = ev.payload.return_value;
      const payload: ToolResultPayload = {
        toolCallId: ev.payload.tool_call_id,
        output: rv.output,
        isError: rv.is_error,
        message: rv.message,
        displayBlocks: rv.display,
      };
      return { type: 'tool_result', payload };
    }

    case 'SubagentEvent': {
      const payload: SubagentEventPayload = {
        parentToolCallId: ev.payload.parent_tool_call_id,
        event: ev.payload.event,
      };
      return { type: 'subagent_event', payload };
    }

    case 'ApprovalRequest': {
      const payload: ApprovalRequestPayload = {
        id: ev.payload.tool_call_id,
        requestId: ev.payload.id,
        action: ev.payload.action,
        description: ev.payload.description,
      };
      return { type: 'approval_request', payload };
    }

    // No-op for MVP: TurnEnd (caller emits from RunResult), StepInterrupted,
    // CompactionBegin/End, HookTriggered/Resolved/Request, SteerInput,
    // ApprovalResponse, ToolCallRequest, QuestionRequest, ParseError.
    default:
      return null;
  }
}

function mapContentPart(
  part: ContentPart,
): TranslatedEvent<TextDeltaPayload | ThinkingDeltaPayload> | null {
  if (part.type === 'text') {
    return { type: 'text_delta', payload: { text: part.text } };
  }
  if (part.type === 'think') {
    const payload: ThinkingDeltaPayload = {
      thinking: part.think,
      ...(part.encrypted ? { encrypted: true } : {}),
    };
    return { type: 'thinking_delta', payload };
  }
  // image_url / audio_url / video_url not in MVP protocol.
  return null;
}

function contentPartsToText(input: string | ContentPart[]): string {
  if (typeof input === 'string') return input;
  return input
    .map((p) => {
      if (p.type === 'text') return p.text;
      return '';
    })
    .join('');
}
