import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ServerWebSocket } from 'bun';
import type {
  AnswerQuestionPayload,
  ApprovalMode,
  ApprovalRequestPayload,
  ApprovalResponse,
  QuestionRequestPayload,
  StatusUpdatePayload,
} from 'shared/types';
import type { WSData } from '../ws/upgrade';
import type { MessageBridge } from './agent/message-bridge';

// In-memory registry of active Claude Agent SDK sessions. Single-instance only —
// no cross-process coordination, by design. WS fan-out state, the
// streaming-input bridge, the live `query` handle, and pending approval/question
// promises all live here for the lifetime of the process.

/**
 * A `canUseTool` permission prompt awaiting the user's decision. `resolve` is
 * the promise resolver inside the `canUseTool` callback; the `approve_tool` WS
 * handler calls it with the user's response, which `approval.ts` maps to the
 * SDK `PermissionResult`.
 */
export interface PendingApproval {
  requestId: string;
  payload: ApprovalRequestPayload;
  resolve: (response: ApprovalResponse) => void;
}

/**
 * An `AskUserQuestion` tool call awaiting answers. Intercepted in every approval
 * mode (it is a question to the user, not a permission). `resolve` is called by
 * the `answer_question` WS handler; `approval.ts` injects the answers into the
 * tool's `updatedInput`.
 */
export interface PendingQuestion {
  requestId: string;
  payload: QuestionRequestPayload;
  resolve: (answer: AnswerQuestionPayload) => void;
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  workDir: string;
  /** SDK session id, captured from the first `msg.session_id`. Null until a
   *  query has emitted its first message. Drives transcript path + resume. */
  sdkSessionId: string | null;
  /** Live query handle for the in-flight turn (AsyncGenerator + control
   *  methods: interrupt/setModel/setPermissionMode/supportedCommands…). Null
   *  between turns. */
  query: Query | null;
  /** Aborts the in-flight query subprocess. Null between turns. */
  abortController: AbortController | null;
  /** Streaming-input queue feeding `query({ prompt: bridge.iterable })`. */
  bridge: MessageBridge | null;
  model: string | null;
  providerId: string | null;
  thinking: boolean;
  approvalMode: ApprovalMode;
  /** True while a query is consuming/emitting for this session. */
  turnInProgress: boolean;
  wsSet: Set<ServerWebSocket<WSData>>;
  pendingApprovals: Map<string, PendingApproval>;
  pendingQuestions: Map<string, PendingQuestion>;
  /** Last assigned outbound seq. Monotonic per session. */
  lastSeq: number;
  /** Unix epoch ms of last outbound activity. */
  lastActivity: number;
  /** Latest status seen this turn; flushed to sessions.totalTokens/Cost at turn end. */
  lastStatusUpdate: StatusUpdatePayload | null;
  /** Maps tool_use.id → tool name; consumed when the matching tool_result fires. */
  toolNameByCallId: Map<string, string>;
  /**
   * Per-session mutex chain serializing transcript backups. The output consumer
   * chains `backupMutex` so concurrent post-block/post-turn flushes cannot
   * interleave `byteOffset` updates.
   */
  backupMutex: Promise<void>;
  /**
   * @internal Synchronous "close in progress" flag. Read/written ONLY through
   * `SessionManager.tryBeginClose`. Pure event-loop semantics — no atomics.
   */
  closing: boolean;
}

export interface RegisterArgs {
  sessionId: string;
  userId: string;
  workDir: string;
  model?: string | null;
  providerId?: string | null;
  thinking?: boolean;
  approvalMode?: ApprovalMode;
}

export type RestoreFn = (sessionId: string) => Promise<ActiveSession>;

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly byUser = new Map<string, Set<string>>();
  /** In-flight restore promises keyed by sessionId — shared so concurrent
   *  waiters restore exactly once. */
  private readonly restoring = new Map<string, Promise<ActiveSession>>();

  /** Insert a freshly created/restored session. Throws on duplicate id. */
  register(args: RegisterArgs): ActiveSession {
    if (this.sessions.has(args.sessionId)) {
      throw new Error(`session ${args.sessionId} already registered`);
    }
    const active: ActiveSession = {
      sessionId: args.sessionId,
      userId: args.userId,
      workDir: args.workDir,
      sdkSessionId: null,
      query: null,
      abortController: null,
      bridge: null,
      model: args.model ?? null,
      providerId: args.providerId ?? null,
      thinking: args.thinking ?? false,
      approvalMode: args.approvalMode ?? 'ask',
      turnInProgress: false,
      wsSet: new Set(),
      pendingApprovals: new Map(),
      pendingQuestions: new Map(),
      lastSeq: 0,
      lastActivity: Date.now(),
      lastStatusUpdate: null,
      toolNameByCallId: new Map(),
      backupMutex: Promise.resolve(),
      closing: false,
    };
    this.sessions.set(args.sessionId, active);
    let userSet = this.byUser.get(args.userId);
    if (!userSet) {
      userSet = new Set();
      this.byUser.set(args.userId, userSet);
    }
    userSet.add(args.sessionId);
    return active;
  }

  /** Remove a session from both maps. Caller is responsible for query teardown. */
  unregister(sessionId: string): ActiveSession | null {
    const active = this.sessions.get(sessionId);
    if (!active) return null;
    this.sessions.delete(sessionId);
    const userSet = this.byUser.get(active.userId);
    if (userSet) {
      userSet.delete(sessionId);
      if (userSet.size === 0) this.byUser.delete(active.userId);
    }
    return active;
  }

  /**
   * Authz lookup: returns the session iff `userId` owns it. Returns `null` for
   * both "no such session" and "owned by someone else" — callers must not
   * disclose the difference.
   */
  getForUser(userId: string, sessionId: string): ActiveSession | null {
    const active = this.sessions.get(sessionId);
    if (!active || active.userId !== userId) return null;
    return active;
  }

  peek(sessionId: string): ActiveSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** True iff sessionId exists in memory regardless of owner. Internal use. */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Atomically claim teardown ownership for `sessionId`. Returns `true` for the
   * winning caller, `false` for any concurrent loser or for sessions already
   * gone. Sets `active.closing = true` synchronously — pure event-loop
   * semantics, no atomics. Caller does the rest of teardown.
   */
  tryBeginClose(sessionId: string): boolean {
    const active = this.sessions.get(sessionId);
    if (!active || active.closing) return false;
    active.closing = true;
    return true;
  }

  /**
   * Resolve every pending approval (as reject) and question (as empty answers)
   * so no `canUseTool` promise is left hanging when a turn is interrupted or a
   * session is torn down. CRITICAL — without this, teardown deadlocks on an
   * awaited permission prompt.
   */
  drainPendingRequests(active: ActiveSession): void {
    for (const pending of active.pendingApprovals.values()) {
      try {
        pending.resolve('reject');
      } catch {
        // resolver already settled
      }
    }
    active.pendingApprovals.clear();
    for (const pending of active.pendingQuestions.values()) {
      try {
        pending.resolve({ requestId: pending.requestId, answers: {} });
      } catch {
        // resolver already settled
      }
    }
    active.pendingQuestions.clear();
  }

  /** Snapshot of sessionIds owned by user (in insertion order). */
  listForUser(userId: string): string[] {
    const set = this.byUser.get(userId);
    return set ? [...set] : [];
  }

  /** Allocate next outbound seq for a session and stamp lastActivity. */
  allocSeq(active: ActiveSession): number {
    active.lastSeq += 1;
    active.lastActivity = Date.now();
    return active.lastSeq;
  }

  attachWS(active: ActiveSession, ws: ServerWebSocket<WSData>): void {
    active.wsSet.add(ws);
  }

  detachWS(active: ActiveSession, ws: ServerWebSocket<WSData>): void {
    active.wsSet.delete(ws);
  }

  /**
   * Remove `ws` from every session it was attached to. Used by the WS close
   * handler — the query keeps running, just no more sockets to fan out to.
   * Returns the count of sessions touched (for diagnostics).
   */
  detachAllWS(ws: ServerWebSocket<WSData>): number {
    let touched = 0;
    for (const active of this.sessions.values()) {
      if (active.wsSet.delete(ws)) touched += 1;
    }
    return touched;
  }

  /**
   * Lazy lookup with shared in-flight cache. If the session is already in memory
   * and owned by `userId`, return it immediately. Otherwise call
   * `restore(sessionId)` exactly once for concurrent waiters; on success,
   * compare ownership and return null on mismatch (uniform not_found).
   *
   * `restore` is responsible for calling `register` itself.
   */
  async getOrRestore(
    userId: string,
    sessionId: string,
    restore: RestoreFn,
  ): Promise<ActiveSession | null> {
    const inMemory = this.sessions.get(sessionId);
    if (inMemory) {
      return inMemory.userId === userId ? inMemory : null;
    }
    let pending = this.restoring.get(sessionId);
    if (!pending) {
      pending = restore(sessionId).finally(() => {
        this.restoring.delete(sessionId);
      });
      this.restoring.set(sessionId, pending);
    }
    let active: ActiveSession;
    try {
      active = await pending;
    } catch {
      // restoreFn throws on missing/closed sessions; surface as not_found.
      return null;
    }
    return active.userId === userId ? active : null;
  }

  /** Total in-memory session count. Diagnostic / metrics. */
  get size(): number {
    return this.sessions.size;
  }
}

// Single instance for the process. Imported by WS handlers and REST routes.
export const sessionManager = new SessionManager();
