// biome-ignore-all lint/suspicious/noExplicitAny: WS event payloads are dynamically shaped per WSMessageType; consumed by the applyEvent switch
import type {
  ApiRetryPayload,
  ApprovalMode,
  Block,
  ContextUsagePayload,
  DisplayBlock,
  EffortLevel,
  QuestionItemDTO,
  RateLimitPayload,
  SnapshotPayload,
  StatusUpdatePayload,
  WSMessageType,
} from 'shared/types';
import { create } from 'zustand';

export interface ChatSessionState {
  blocks: Block[];
  /** Cumulative session token usage, mirrored from `status_update`/snapshot. */
  totalTokens: number | null;
  /** Rich context-window breakdown from the latest `context_usage` event / snapshot. */
  contextUsage: ContextUsagePayload | null;
  /**
   * Bumped on each `turn_end` — a subscribable signal that context usage may have
   * changed. The right sidebar watches this to re-request usage while open,
   * instead of re-parsing raw WS frames.
   */
  contextEpoch: number;
  /** Cumulative session cost in USD, from `status_update`/snapshot. */
  totalCostUsd: number | null;
  title: string | null;
  pendingPrompt: { text: string; enqueuedAt: string } | null;
  isTurnInProgress: boolean;
  /** Per-session agent flags, mirrored from the snapshot (true server state). */
  thinking: boolean;
  approvalMode: ApprovalMode;
  /** Reasoning effort, applied from the prompt it rides with onward; `null` is the provider default. */
  effort: EffortLevel | null;
  /** Latest provider quota status from `rate_limit`; null when the provider never reports it. */
  rateLimit: RateLimitPayload | null;
  /** In-flight API retry notice from `api_retry`; cleared on the next stream activity. */
  apiRetry: ApiRetryPayload | null;
}

interface ChatStore {
  sessions: Record<string, ChatSessionState>;
  getOrCreateSession: (sessionId: string) => ChatSessionState;
  loadSnapshot: (sessionId: string, payload: SnapshotPayload) => void;
  applyEvent: (sessionId: string, type: WSMessageType, payload: any, seq?: number) => void;
  addPendingUserBlock: (sessionId: string, text: string) => void;
  /** Optimistic local update of agent flags; server echoes the truth via snapshot. */
  setSessionFlags: (
    sessionId: string,
    flags: { thinking?: boolean; approvalMode?: ApprovalMode; effort?: EffortLevel | null },
  ) => void;
  /** Drop a session's in-memory chat state when the session is deleted. */
  removeSession: (sessionId: string) => void;
}

const createDefaultSessionState = (): ChatSessionState => ({
  blocks: [],
  totalTokens: null,
  contextUsage: null,
  contextEpoch: 0,
  totalCostUsd: null,
  title: null,
  pendingPrompt: null,
  isTurnInProgress: false,
  thinking: true,
  approvalMode: 'ask',
  effort: null,
  rateLimit: null,
  apiRetry: null,
});

const now = (): string => new Date().toISOString();

// Fallback monotonic counter for error block ids when the WS envelope `seq` is
// not threaded through (e.g. local optimistic applyEvent calls). Keeps ids
// stable and collision-free without relying on Date.now().
let localSeqFallback = 0;

/**
 * Recursively find the name of the tool_call matching `toolCallId`, descending
 * into subagent block lists so a nested tool_result can label itself.
 */
function findToolCallNameInBlocks(blocks: Block[], toolCallId: string): string {
  for (const b of blocks) {
    if (b.kind === 'tool_call' && b.toolCallId === toolCallId) {
      return b.name;
    }
    if (b.kind === 'subagent') {
      const nestedName = findToolCallNameInBlocks(b.blocks, toolCallId);
      if (nestedName) return nestedName;
    }
  }
  return '';
}

/**
 * Pure applicator: given the current block list and one WS event, return the
 * next block list. Block ids are SERVER-ASSIGNED and stable — this function
 * NEVER computes positional ids. It finds a block by id and appends/sets, or
 * pushes a new block when none exists. `subagent_event` recurses through the
 * same function so nested blocks get the identical stable-id treatment.
 *
 * `seq` is the WS envelope sequence number, used only to mint a stable,
 * collision-free id for `error` blocks.
 */
function applyEventToBlocks(
  blocks: Block[],
  type: WSMessageType,
  payload: any,
  seq: number,
): Block[] {
  switch (type) {
    case 'turn_begin': {
      const userBlock: Block = {
        kind: 'user',
        id: payload.id,
        content: payload.userInput ?? '',
        status: 'sent',
        createdAt: now(),
      };
      // Drop any optimistic pending user block; the server's echo replaces it.
      const filtered = blocks.filter((b) => b.kind !== 'user' || b.status !== 'pending');
      return [...filtered, userBlock];
    }

    case 'text_delta': {
      const idx = blocks.findIndex((b) => b.kind === 'text' && b.id === payload.id);
      if (idx >= 0) {
        const existing = blocks[idx] as Extract<Block, { kind: 'text' }>;
        const next = [...blocks];
        next[idx] = payload.final
          ? { ...existing, content: payload.text, isStreaming: false }
          : { ...existing, content: existing.content + payload.text, isStreaming: true };
        return next;
      }
      const newBlock: Block = {
        kind: 'text',
        id: payload.id,
        content: payload.text,
        isStreaming: !payload.final,
        createdAt: now(),
      };
      return [...blocks, newBlock];
    }

    case 'thinking_delta': {
      const idx = blocks.findIndex((b) => b.kind === 'thinking' && b.id === payload.id);
      if (idx >= 0) {
        const existing = blocks[idx] as Extract<Block, { kind: 'thinking' }>;
        const next = [...blocks];
        next[idx] = payload.final
          ? {
              ...existing,
              content: payload.thinking,
              encrypted: !!payload.encrypted,
              isStreaming: false,
            }
          : {
              ...existing,
              content: existing.content + payload.thinking,
              encrypted: !!payload.encrypted,
              isStreaming: true,
            };
        return next;
      }
      const newBlock: Block = {
        kind: 'thinking',
        id: payload.id,
        content: payload.thinking,
        encrypted: !!payload.encrypted,
        isStreaming: !payload.final,
        createdAt: now(),
      };
      return [...blocks, newBlock];
    }

    case 'tool_call': {
      // Upsert by id. A `tool_call` after streaming deltas carries the full,
      // parsed `arguments` — set it and clear streaming. Tool calls never carry
      // their own streaming spinner; the timeline derives status from whether a
      // tool_result is present.
      const idx = blocks.findIndex((b) => b.kind === 'tool_call' && b.toolCallId === payload.id);
      if (idx >= 0) {
        const existing = blocks[idx] as Extract<Block, { kind: 'tool_call' }>;
        const next = [...blocks];
        next[idx] = {
          ...existing,
          name: payload.name,
          args: payload.arguments,
          isStreaming: false,
        };
        return next;
      }
      const newBlock: Block = {
        kind: 'tool_call',
        id: payload.id,
        toolCallId: payload.id,
        name: payload.name,
        args: payload.arguments,
        isStreaming: false,
        createdAt: now(),
      };
      return [...blocks, newBlock];
    }

    case 'tool_call_delta': {
      const idx = blocks.findIndex((b) => b.kind === 'tool_call' && b.toolCallId === payload.id);
      if (idx < 0) return blocks;
      const existing = blocks[idx] as Extract<Block, { kind: 'tool_call' }>;
      const next = [...blocks];
      // Append raw argument text only. Adapters parse `argsStreaming` (head+tail)
      // as a fallback for partial JSON; never set `args` from a delta.
      next[idx] = {
        ...existing,
        argsStreaming: (existing.argsStreaming ?? '') + payload.argumentsPart,
      };
      return next;
    }

    case 'tool_result': {
      const toolName = findToolCallNameInBlocks(blocks, payload.toolCallId);
      const resultBlock: Block = {
        kind: 'tool_result',
        id: payload.toolCallId,
        toolCallId: payload.toolCallId,
        toolName,
        output: payload.output,
        message: payload.message ?? null,
        displayBlocks: (payload.displayBlocks as DisplayBlock[]) ?? [],
        isError: payload.isError,
        createdAt: now(),
      };
      // Stop the matching tool_call from streaming, then append the result.
      // A question_request sharing the toolCallId has been answered (or denied
      // on abort) — mark it resolved so the dock and inline anchor settle.
      const next = blocks.map((b) => {
        if (b.kind === 'tool_call' && b.toolCallId === payload.toolCallId) {
          return { ...b, isStreaming: false };
        }
        if (b.kind === 'question_request' && b.toolCallId === payload.toolCallId && !b.resolved) {
          return { ...b, resolved: true };
        }
        return b;
      });
      return [...next, resultBlock];
    }

    case 'approval_request': {
      const id = `approval:${payload.requestId}`;
      if (blocks.some((b) => b.kind === 'approval_request' && b.id === id)) return blocks;
      const newBlock: Block = {
        kind: 'approval_request',
        id,
        requestId: payload.requestId,
        toolCallId: payload.id,
        action: payload.action,
        description: payload.description,
        createdAt: now(),
      };
      return [...blocks, newBlock];
    }

    case 'approval_response': {
      return blocks.map((b) =>
        b.kind === 'approval_request' && b.requestId === payload.requestId
          ? { ...b, resolution: payload.response }
          : b,
      );
    }

    case 'question_request': {
      const id = `question:${payload.requestId}`;
      if (blocks.some((b) => b.kind === 'question_request' && b.id === id)) return blocks;
      const newBlock: Block = {
        kind: 'question_request',
        id,
        requestId: payload.requestId,
        // QuestionRequestPayload.id carries the SDK tool_call_id.
        toolCallId: payload.id,
        questions: payload.questions as QuestionItemDTO[],
        createdAt: now(),
      };
      return [...blocks, newBlock];
    }

    // Client-local echo (never broadcast by the server): applied by QuestionCard
    // on submit so the dock advances and the inline anchor flips to the answer
    // summary without waiting for the tool_result round-trip.
    case 'answer_question': {
      return blocks.map((b) =>
        b.kind === 'question_request' && b.requestId === payload.requestId
          ? { ...b, resolved: true, answers: payload.answers as Record<string, string> }
          : b,
      );
    }

    case 'subagent_event': {
      return applySubagentEvent(blocks, payload, seq);
    }

    case 'turn_end': {
      return blocks.map((b) =>
        (b.kind === 'text' ||
          b.kind === 'thinking' ||
          b.kind === 'tool_call' ||
          b.kind === 'subagent') &&
        b.isStreaming
          ? { ...b, isStreaming: false }
          : b,
      );
    }

    case 'error': {
      const newBlock: Block = {
        kind: 'error',
        id: `error:${seq}`,
        code: payload.code,
        message: payload.message,
        createdAt: now(),
      };
      return [...blocks, newBlock];
    }

    default:
      return blocks;
  }
}

/**
 * Find or create the `subagent` block for `parentToolCallId`, recurse the inner
 * event into its own block list via the same applicator, and write it back
 * immutably (matched by id — no index hacks). The subagent is attached right
 * after its parent tool_call when first created; if the parent is absent it is
 * appended at the end.
 */
function applySubagentEvent(blocks: Block[], payload: any, seq: number): Block[] {
  const subagentId = `subagent:${payload.parentToolCallId}`;
  let next = [...blocks];

  let idx = next.findIndex((b) => b.kind === 'subagent' && b.id === subagentId);
  if (idx < 0) {
    const newSubagent: Block = {
      kind: 'subagent',
      id: subagentId,
      parentToolCallId: payload.parentToolCallId,
      subagentType: payload.subagentType,
      description: payload.description,
      blocks: [],
      isStreaming: true,
      createdAt: now(),
    };
    const parentIdx = next.findIndex(
      (b) => b.kind === 'tool_call' && b.toolCallId === payload.parentToolCallId,
    );
    if (parentIdx >= 0) {
      next = [...next.slice(0, parentIdx + 1), newSubagent, ...next.slice(parentIdx + 1)];
      idx = parentIdx + 1;
    } else {
      next.push(newSubagent);
      idx = next.length - 1;
    }
  }

  const current = next[idx];
  if (current?.kind !== 'subagent') return next;

  const updated: Block = { ...current };
  // Header-only frames (inner === null) just carry subagentType/description.
  if (payload.subagentType !== undefined) updated.subagentType = payload.subagentType;
  if (payload.description !== undefined) updated.description = payload.description;

  const inner = payload.inner as { type: WSMessageType; payload: unknown } | null;
  if (inner) {
    updated.blocks = applyEventToBlocks(updated.blocks, inner.type, inner.payload as any, seq);
    // A nested turn_end ends the subagent's own streaming; any other inner
    // event means it is still active.
    updated.isStreaming = inner.type !== 'turn_end';
  }

  next[idx] = updated;
  return next;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},

  getOrCreateSession: (sessionId: string) => {
    const existing = get().sessions[sessionId];
    if (existing) return existing;
    const created = createDefaultSessionState();
    set((s) => ({ sessions: { ...s.sessions, [sessionId]: created } }));
    return created;
  },

  loadSnapshot: (sessionId: string, payload: SnapshotPayload) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        // Server is authoritative: replace blocks wholesale. Blocks already
        // carry stable ids and are fully rendered. The server sends snapshot OR
        // replay (never both), so replayed deltas append safely afterwards.
        [sessionId]: {
          blocks: payload.blocks,
          totalTokens: payload.totalTokens,
          contextUsage: payload.contextUsage,
          contextEpoch: 0,
          totalCostUsd: payload.totalCostUsd ?? null,
          title: payload.title,
          pendingPrompt: payload.pendingPrompt,
          isTurnInProgress: payload.live.turnInProgress,
          thinking: payload.thinking ?? true,
          approvalMode: payload.approvalMode ?? 'ask',
          effort: payload.effort ?? null,
          // Provider quota status survives a re-snapshot (it is provider-level,
          // not transcript state); the transient retry notice does not.
          rateLimit: state.sessions[sessionId]?.rateLimit ?? null,
          apiRetry: null,
        },
      },
    }));
  },

  applyEvent: (sessionId: string, type: WSMessageType, payload: any, seq?: number) => {
    get().getOrCreateSession(sessionId);

    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;

      const effectiveSeq = seq ?? ++localSeqFallback;
      const session: ChatSessionState = { ...existing };

      // Apply the event to the block list via the pure applicator.
      session.blocks = applyEventToBlocks(existing.blocks, type, payload, effectiveSeq);

      // Top-level lifecycle + metadata that lives outside the block list.
      switch (type) {
        case 'turn_begin':
          session.isTurnInProgress = true;
          session.pendingPrompt = null;
          break;
        case 'turn_end':
          session.isTurnInProgress = false;
          // Signal a context-usage change (covers normal turns and the turn that
          // wraps a /compact). Subscribers re-request usage off this counter.
          session.contextEpoch += 1;
          break;
        case 'error':
          session.isTurnInProgress = false;
          break;
        case 'status_update': {
          const p = payload as StatusUpdatePayload;
          if (p) {
            session.totalTokens = p.tokenUsage;
            if (p.totalCostUsd !== undefined) session.totalCostUsd = p.totalCostUsd;
          }
          break;
        }
        case 'context_usage':
          session.contextUsage = payload as ContextUsagePayload;
          break;
        case 'rate_limit':
          session.rateLimit = payload as RateLimitPayload;
          break;
        case 'api_retry':
          session.apiRetry = payload as ApiRetryPayload;
          break;
        case 'title_update':
          if (payload?.title) session.title = payload.title;
          break;
        default:
          break;
      }

      // The retry notice is transient: any other session event means the stream
      // moved on (retry succeeded, errored out, or the turn ended) — clear it.
      if (session.apiRetry && type !== 'api_retry' && type !== 'rate_limit') {
        session.apiRetry = null;
      }

      return { sessions: { ...state.sessions, [sessionId]: session } };
    });
  },

  addPendingUserBlock: (sessionId: string, text: string) => {
    get().getOrCreateSession(sessionId);
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;

      const pendingId = `user:pending:${sessionId}`;
      const pendingBlock: Block = {
        kind: 'user',
        id: pendingId,
        content: text,
        status: 'pending',
        createdAt: now(),
      };

      const filtered = existing.blocks.filter((b) => b.id !== pendingId);
      const session: ChatSessionState = {
        ...existing,
        blocks: [...filtered, pendingBlock],
        pendingPrompt: { text, enqueuedAt: now() },
      };
      return { sessions: { ...state.sessions, [sessionId]: session } };
    });
  },

  setSessionFlags: (sessionId, flags) => {
    get().getOrCreateSession(sessionId);
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      const session: ChatSessionState = { ...existing };
      if (flags.thinking !== undefined) session.thinking = flags.thinking;
      if (flags.approvalMode !== undefined) session.approvalMode = flags.approvalMode;
      if (flags.effort !== undefined) session.effort = flags.effort;
      return { sessions: { ...state.sessions, [sessionId]: session } };
    });
  },

  removeSession: (sessionId: string) => {
    todoFoldCache.delete(sessionId);
    set((state) => {
      if (!(sessionId in state.sessions)) return state;
      const { [sessionId]: _removed, ...rest } = state.sessions;
      return { sessions: rest };
    });
  },
}));

export function useSessionChat(sessionId: string | undefined): ChatSessionState | null {
  return useChatStore((state) => {
    if (!sessionId) return null;
    return state.sessions[sessionId] ?? null;
  });
}

type TodoItems = Extract<DisplayBlock, { type: 'todo' }>['items'];
type TodoTaskBlock = Extract<DisplayBlock, { type: 'todo' | 'task' }>;

/** Collect the todo/task display blocks from the timeline, in order. */
function collectTodoBlocks(blocks: Block[]): TodoTaskBlock[] {
  const out: TodoTaskBlock[] = [];
  for (const b of blocks) {
    if (b.kind !== 'tool_result') continue;
    for (const d of b.displayBlocks ?? []) {
      if (d.type === 'todo' || d.type === 'task') out.push(d);
    }
  }
  return out;
}

/**
 * Fold todo/task display blocks, in timeline order, into the current
 * checklist. `todo` blocks (TodoWrite) and `task` list snapshots (TaskList)
 * replace the whole list; `task` create/update blocks (TaskCreate/TaskUpdate)
 * mutate one entry by id, `status: 'deleted'` removes it. TodoWrite keys by
 * position, task ops by task id — switching source families resets the map so
 * the two key vocabularies never coexist. Returns `null` when no todo/task
 * display block exists yet.
 */
function foldTodos(folded: TodoTaskBlock[]): TodoItems | null {
  if (folded.length === 0) return null;
  let items = new Map<string, TodoItems[number]>();
  let family: 'todo' | 'task' | null = null;
  for (const d of folded) {
    if (d.type === 'todo') {
      family = 'todo';
      items = new Map(d.items.map((it, i) => [String(i), it]));
    } else {
      if (family !== 'task') items = new Map();
      family = 'task';
      if (d.op === 'create') {
        items.set(d.id, { title: d.title, status: 'pending' });
      } else if (d.op === 'update') {
        const prev = items.get(d.id);
        if (d.status === 'deleted') {
          items.delete(d.id);
        } else if (prev || d.title) {
          // Updates for tasks created outside this timeline (e.g. by a
          // subagent) carry no title — nothing meaningful to show; skip.
          items.set(d.id, {
            title: d.title ?? prev?.title ?? '',
            status: d.status ?? prev?.status ?? 'pending',
          });
        }
      } else {
        items = new Map(d.items.map((it) => [it.id, { title: it.title, status: it.status }]));
      }
    }
  }
  return [...items.values()];
}

// Per-session fold cache. Streaming deltas replace `session.blocks` identity
// many times per second while the todo/task display blocks (created once per
// tool_result) keep theirs — comparing those identities lets the selector
// return a stable array (no TodoPanel re-render, no re-fold) until a todo/task
// block is actually appended.
const todoFoldCache = new Map<string, { key: TodoTaskBlock[]; value: TodoItems | null }>();

/**
 * Hook: the session's current todo checklist, folded from TodoWrite snapshots
 * and incremental TaskCreate/TaskUpdate/TaskList events (see `foldTodos`).
 */
export function useLatestTodos(sessionId: string | undefined): TodoItems | null {
  return useChatStore((state) => {
    if (!sessionId) return null;
    const session = state.sessions[sessionId];
    if (!session) return null;
    const relevant = collectTodoBlocks(session.blocks);
    const cached = todoFoldCache.get(sessionId);
    if (
      cached &&
      cached.key.length === relevant.length &&
      cached.key.every((d, i) => d === relevant[i])
    ) {
      return cached.value;
    }
    const value = foldTodos(relevant);
    todoFoldCache.set(sessionId, { key: relevant, value });
    return value;
  });
}
