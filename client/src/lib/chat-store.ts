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
  TaskNotificationPayload,
  TaskProgressPayload,
  TaskStartedPayload,
  TaskUpdatedPayload,
  WorkflowChild,
  WSMessageType,
} from 'shared/types';
import {
  LOCAL_WORKFLOW_TASK_TYPE,
  mapWorkflowChildStatus,
  mapWorkflowRunStatus,
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
  /** Ultracode toggle: xhigh effort + standing dynamic-workflow orchestration. */
  ultracode: boolean;
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
    flags: {
      thinking?: boolean;
      approvalMode?: ApprovalMode;
      effort?: EffortLevel | null;
      ultracode?: boolean;
    },
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
  ultracode: false,
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

    case 'task_started':
      return applyTaskStarted(blocks, payload as TaskStartedPayload);

    case 'task_progress':
      return applyTaskProgress(blocks, payload as TaskProgressPayload);

    case 'task_updated':
      return applyTaskUpdated(blocks, payload as TaskUpdatedPayload);

    case 'task_notification':
      return applyTaskNotification(blocks, payload as TaskNotificationPayload);

    case 'turn_end': {
      const stopped = blocks.map((b) =>
        (b.kind === 'text' ||
          b.kind === 'thinking' ||
          b.kind === 'tool_call' ||
          b.kind === 'subagent') &&
        b.isStreaming
          ? { ...b, isStreaming: false }
          : b,
      );
      // A user-cancelled turn ends with a quiet marker, not an error block.
      if (payload?.status === 'cancelled') {
        const marker: Block = { kind: 'cancelled', id: `cancelled:${seq}`, createdAt: now() };
        return [...stopped, marker];
      }
      return stopped;
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
 * Find the block container (a `Block[]`) at the end of `path`, where `path` is a
 * list of subagent indices leading from the root blocks into nested subagent
 * block lists. An empty path means the root blocks array.
 */
function getContainerByPath(root: Block[], path: number[]): Block[] {
  let container = root;
  for (const idx of path) {
    const block = container[idx];
    if (block?.kind !== 'subagent') return container;
    container = block.blocks;
  }
  return container;
}

/**
 * Apply an immutable update to a container identified by `path`. Recursively
 * rebuilds the ancestor subagent blocks so React/Zustand consumers see a new
 * reference at every level.
 */
function updateContainerAtPath(
  root: Block[],
  path: number[],
  updater: (container: Block[]) => Block[],
): Block[] {
  if (path.length === 0) {
    return updater(root);
  }
  const head = path[0];
  if (head == null) return root;
  const tail = path.slice(1);
  const block = root[head];
  if (block?.kind !== 'subagent') return root;
  const updatedBlocks = updateContainerAtPath(block.blocks, tail, updater);
  const next = [...root];
  next[head] = { ...block, blocks: updatedBlocks };
  return next;
}

/** Recursively locate a subagent block by id, returning its path + index. */
function findSubagentLocation(
  blocks: Block[],
  id: string,
  path: number[] = [],
): { rootPath: number[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b == null) continue;
    if (b.kind === 'subagent' && b.id === id) {
      return { rootPath: path, index: i };
    }
    if (b.kind === 'subagent') {
      const nested = findSubagentLocation(b.blocks, id, [...path, i]);
      if (nested) return nested;
    }
  }
  return null;
}

/** Recursively locate the parent `tool_call` for a subagent, returning its path + index. */
function findParentToolCallLocation(
  blocks: Block[],
  parentToolCallId: string,
  path: number[] = [],
): { rootPath: number[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b == null) continue;
    if (b.kind === 'tool_call' && b.toolCallId === parentToolCallId) {
      return { rootPath: path, index: i };
    }
    if (b.kind === 'subagent') {
      const nested = findParentToolCallLocation(b.blocks, parentToolCallId, [...path, i]);
      if (nested) return nested;
    }
  }
  return null;
}

function createSubagentBlock(payload: any): Block {
  return {
    kind: 'subagent',
    id: `subagent:${payload.parentToolCallId}`,
    parentToolCallId: payload.parentToolCallId,
    subagentType: payload.subagentType,
    description: payload.description,
    blocks: [],
    isStreaming: true,
    createdAt: now(),
  };
}

function updateSubagentBlock(block: Block, payload: any, seq: number): Block {
  if (block.kind !== 'subagent') return block;
  const updated: Block = { ...block };
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
  return updated;
}

/**
 * Find or create the `subagent` block for `parentToolCallId`, recurse the inner
 * event into its own block list via the same applicator, and write it back
 * immutably (matched by id — no index hacks). The subagent is attached right
 * after its parent tool_call when first created; if the parent is absent it is
 * appended at the end.
 *
 * The search is recursive so that subagents spawned inside a workflow run (or
 * any other nested subagent) are placed next to their parent `tool_call` inside
 * the run's nested blocks, instead of being orphaned at the top level.
 */
function applySubagentEvent(blocks: Block[], payload: any, seq: number): Block[] {
  const subagentId = `subagent:${payload.parentToolCallId}`;
  const parentToolCallId = payload.parentToolCallId;

  const parentLoc = findParentToolCallLocation(blocks, parentToolCallId);
  const existingLoc = findSubagentLocation(blocks, subagentId);

  // Parent tool_call exists somewhere — place the subagent right after it.
  if (parentLoc) {
    let working = blocks;
    let subagent: Block;

    if (existingLoc) {
      const existingBlock = getContainerByPath(blocks, existingLoc.rootPath)[existingLoc.index];
      if (!existingBlock) {
        // Existing location is stale; treat as a fresh subagent.
        subagent = updateSubagentBlock(createSubagentBlock(payload), payload, seq);
      } else {
        subagent = existingBlock;
        // Remove from the old location first so the insert below is exact.
        working = updateContainerAtPath(blocks, existingLoc.rootPath, (container) => [
          ...container.slice(0, existingLoc.index),
          ...container.slice(existingLoc.index + 1),
        ]);
      }
      // Re-locate the parent in the post-removal tree (removal may have shifted indices).
      const relocated = findParentToolCallLocation(working, parentToolCallId);
      if (!relocated) {
        // Parent disappeared during cleanup; shouldn't happen, but keep the subagent at top level.
        return [...working, updateSubagentBlock(subagent, payload, seq)];
      }
      subagent = updateSubagentBlock(subagent, payload, seq);
      return updateContainerAtPath(working, relocated.rootPath, (container) => [
        ...container.slice(0, relocated.index + 1),
        subagent,
        ...container.slice(relocated.index + 1),
      ]);
    }

    subagent = updateSubagentBlock(createSubagentBlock(payload), payload, seq);
    return updateContainerAtPath(working, parentLoc.rootPath, (container) => [
      ...container.slice(0, parentLoc.index + 1),
      subagent,
      ...container.slice(parentLoc.index + 1),
    ]);
  }

  // No parent tool_call yet. Update an existing subagent if we have one, else
  // append at the top level as a best-effort fallback.
  if (existingLoc) {
    return updateContainerAtPath(blocks, existingLoc.rootPath, (container) => {
      const existingBlock = container[existingLoc.index];
      if (!existingBlock) return container;
      const updated = updateSubagentBlock(existingBlock, payload, seq);
      const next = [...container];
      next[existingLoc.index] = updated;
      return next;
    });
  }

  return [...blocks, updateSubagentBlock(createSubagentBlock(payload), payload, seq)];
}

type WorkflowBlock = Extract<Block, { kind: 'workflow' }>;

/**
 * Upsert a child task into a workflow block's `children`, keyed by `taskId`.
 * `undefined` patch fields are dropped so they never clobber the required
 * `description`/`status` on an existing child.
 */
function upsertWorkflowChild(
  block: WorkflowBlock,
  taskId: string,
  patch: Partial<WorkflowChild>,
): WorkflowBlock {
  const idx = block.children.findIndex((c) => c.taskId === taskId);
  const existing = idx >= 0 ? block.children[idx] : undefined;
  const merged: WorkflowChild = existing
    ? { ...existing, taskId }
    : { taskId, description: '', status: 'running' };
  if (patch.description !== undefined) merged.description = patch.description;
  if (patch.status !== undefined) merged.status = patch.status;
  if (patch.lastToolName !== undefined) merged.lastToolName = patch.lastToolName;
  if (patch.summary !== undefined) merged.summary = patch.summary;
  if (patch.usage !== undefined) merged.usage = patch.usage;
  if (existing) {
    const children = [...block.children];
    children[idx] = merged;
    return { ...block, children };
  }
  return { ...block, children: [...block.children, merged] };
}

/**
 * `task_started`: a RUN frame (workflowName set or taskType 'local_workflow')
 * upserts the run-level workflow block, anchored right after its tool_call; any
 * other frame attributes a CHILD task to the workflow named by `toolCallId`.
 */
function applyTaskStarted(blocks: Block[], payload: TaskStartedPayload): Block[] {
  const toolCallId = payload.toolCallId ?? '';
  const isRun = payload.workflowName !== undefined || payload.taskType === LOCAL_WORKFLOW_TASK_TYPE;

  if (isRun) {
    const id = `workflow:${toolCallId}`;
    const idx = blocks.findIndex((b) => b.kind === 'workflow' && b.id === id);
    if (idx >= 0) {
      const existing = blocks[idx] as WorkflowBlock;
      const next = [...blocks];
      next[idx] = {
        ...existing,
        status: 'running',
        runId: payload.taskId,
        workflowName: payload.workflowName ?? existing.workflowName,
      };
      return next;
    }
    const newBlock: Block = {
      kind: 'workflow',
      id,
      toolCallId,
      runId: payload.taskId,
      workflowName: payload.workflowName,
      status: 'running',
      children: [],
      createdAt: now(),
    };
    const parentIdx = blocks.findIndex(
      (b) => b.kind === 'tool_call' && b.toolCallId === toolCallId,
    );
    if (parentIdx >= 0) {
      return [...blocks.slice(0, parentIdx + 1), newBlock, ...blocks.slice(parentIdx + 1)];
    }
    return [...blocks, newBlock];
  }

  // Child task: attribute to the workflow named by `toolCallId`.
  const idx = blocks.findIndex((b) => b.kind === 'workflow' && b.toolCallId === toolCallId);
  if (idx < 0) return blocks;
  const next = [...blocks];
  next[idx] = upsertWorkflowChild(next[idx] as WorkflowBlock, payload.taskId, {
    description: payload.description,
    status: 'running',
  });
  return next;
}

/**
 * `task_progress`: a run-level frame (matched by `runId`) updates the block's
 * aggregate usage; otherwise the frame updates the matching child task.
 */
function applyTaskProgress(blocks: Block[], payload: TaskProgressPayload): Block[] {
  const runIdx = blocks.findIndex((b) => b.kind === 'workflow' && b.runId === payload.taskId);
  if (runIdx >= 0) {
    const existing = blocks[runIdx] as WorkflowBlock;
    const next = [...blocks];
    next[runIdx] = { ...existing, usage: payload.usage };
    return next;
  }
  const childIdx = blocks.findIndex(
    (b) => b.kind === 'workflow' && b.children.some((c) => c.taskId === payload.taskId),
  );
  if (childIdx < 0) return blocks;
  const next = [...blocks];
  next[childIdx] = upsertWorkflowChild(next[childIdx] as WorkflowBlock, payload.taskId, {
    description: payload.description,
    lastToolName: payload.lastToolName,
    summary: payload.summary,
    usage: payload.usage,
    status: 'running',
  });
  return next;
}

/**
 * `task_updated`: merge a wire-safe patch by `taskId`. Status is mapped through
 * the shared `mapWorkflowRunStatus`/`mapWorkflowChildStatus` truth tables
 * (`null` leaves the current status unchanged). The child union has no error
 * field, so `patch.error` is ignored.
 */
function applyTaskUpdated(blocks: Block[], payload: TaskUpdatedPayload): Block[] {
  const { patch } = payload;

  const runIdx = blocks.findIndex((b) => b.kind === 'workflow' && b.runId === payload.taskId);
  if (runIdx >= 0) {
    const existing = blocks[runIdx] as WorkflowBlock;
    const mapped = patch.status !== undefined ? mapWorkflowRunStatus(patch.status) : null;
    const next = [...blocks];
    next[runIdx] = { ...existing, status: mapped ?? existing.status };
    return next;
  }

  const childIdx = blocks.findIndex(
    (b) => b.kind === 'workflow' && b.children.some((c) => c.taskId === payload.taskId),
  );
  if (childIdx < 0) return blocks;
  const childPatch: Partial<WorkflowChild> = {};
  if (patch.status !== undefined) {
    const mapped = mapWorkflowChildStatus(patch.status);
    if (mapped !== null) childPatch.status = mapped;
  }
  if (patch.description !== undefined) childPatch.description = patch.description;
  const next = [...blocks];
  next[childIdx] = upsertWorkflowChild(next[childIdx] as WorkflowBlock, payload.taskId, childPatch);
  return next;
}

/**
 * `task_notification`: terminal result for a run (matched by `runId`) or an
 * attributed child. Status is mapped through the shared
 * `mapWorkflowRunStatus`/`mapWorkflowChildStatus` truth tables, so a child
 * `stopped` settles as `failed` (the child union has no `stopped` state).
 */
function applyTaskNotification(blocks: Block[], payload: TaskNotificationPayload): Block[] {
  const runIdx = blocks.findIndex((b) => b.kind === 'workflow' && b.runId === payload.taskId);
  if (runIdx >= 0) {
    const existing = blocks[runIdx] as WorkflowBlock;
    const mapped = mapWorkflowRunStatus(payload.status);
    const next = [...blocks];
    next[runIdx] = {
      ...existing,
      status: mapped ?? existing.status,
      summary: payload.summary,
      usage: payload.usage ?? existing.usage,
    };
    return next;
  }

  const childIdx = blocks.findIndex(
    (b) => b.kind === 'workflow' && b.children.some((c) => c.taskId === payload.taskId),
  );
  if (childIdx < 0) return blocks;
  const childPatch: Partial<WorkflowChild> = {
    summary: payload.summary,
    usage: payload.usage,
  };
  const mapped = mapWorkflowChildStatus(payload.status);
  if (mapped !== null) childPatch.status = mapped;
  const next = [...blocks];
  next[childIdx] = upsertWorkflowChild(next[childIdx] as WorkflowBlock, payload.taskId, childPatch);
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
          ultracode: payload.ultracode ?? false,
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
      if (flags.ultracode !== undefined) session.ultracode = flags.ultracode;
      return { sessions: { ...state.sessions, [sessionId]: session } };
    });
  },

  removeSession: (sessionId: string) => {
    todoFoldCache.delete(sessionId);
    activeWorkflowCache.delete(sessionId);
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

/** Collect the workflow blocks from the timeline, in order. */
function collectWorkflowBlocks(blocks: Block[]): WorkflowBlock[] {
  const out: WorkflowBlock[] = [];
  for (const b of blocks) {
    if (b.kind === 'workflow') out.push(b);
  }
  return out;
}

/**
 * Resolve the workflow block the active-run UI should track: the latest running
 * workflow, or — only while the turn is still in progress — the latest finished
 * one. Returns null once the turn ends and nothing is running.
 */
function resolveActiveWorkflow(
  workflows: WorkflowBlock[],
  turnInProgress: boolean,
): WorkflowBlock | null {
  let latestRunning: WorkflowBlock | null = null;
  let latestFinished: WorkflowBlock | null = null;
  for (const b of workflows) {
    if (b.status === 'running') latestRunning = b;
    else latestFinished = b;
  }
  if (latestRunning) return latestRunning;
  return turnInProgress ? latestFinished : null;
}

// Per-session active-workflow cache. Mirrors `todoFoldCache`: streaming deltas
// churn `session.blocks` identity many times per second while the workflow
// blocks keep theirs — comparing those identities (plus the turn flag, which
// flips the finished-fallback) returns a stable reference until a workflow
// block or the turn state actually changes.
const activeWorkflowCache = new Map<
  string,
  { key: WorkflowBlock[]; turnInProgress: boolean; value: WorkflowBlock | null }
>();

/**
 * Hook: the workflow block the active-run UI should surface for `sessionId`
 * (see `resolveActiveWorkflow`), or null when none applies.
 */
export function useActiveWorkflow(sessionId: string | null): WorkflowBlock | null {
  return useChatStore((state) => {
    if (!sessionId) return null;
    const session = state.sessions[sessionId];
    if (!session) return null;
    const relevant = collectWorkflowBlocks(session.blocks);
    const cached = activeWorkflowCache.get(sessionId);
    if (
      cached &&
      cached.turnInProgress === session.isTurnInProgress &&
      cached.key.length === relevant.length &&
      cached.key.every((b, i) => b === relevant[i])
    ) {
      return cached.value;
    }
    const value = resolveActiveWorkflow(relevant, session.isTurnInProgress);
    activeWorkflowCache.set(sessionId, {
      key: relevant,
      turnInProgress: session.isTurnInProgress,
      value,
    });
    return value;
  });
}
