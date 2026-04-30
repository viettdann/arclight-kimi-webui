import type { Session, Turn } from '@moonshot-ai/kimi-agent-sdk';
import type { ServerWebSocket } from 'bun';
import type { ApprovalRequestPayload, StatusUpdatePayload } from 'shared/types';
import { createEventBuffer, type EventBuffer } from '../lib/event-buffer';
import type { TranslatorState } from '../ws/events';
import { createTranslatorState } from '../ws/events';
import type { WSData } from '../ws/upgrade';

// In-memory registry of active Kimi sessions. Single-instance only — there is
// no cross-process coordination, by design. WS state, EventBuffer, and pending
// approvals all live here for the lifetime of the process.

export interface PendingApproval {
  requestId: string;
  payload: ApprovalRequestPayload;
  // SDK Turn that issued the approval — held so we can call turn.approve().
  turn: Turn;
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  workDir: string;
  kimiSessionId: string;
  kimiSession: Session;
  currentTurn: Turn | null;
  wsSet: Set<ServerWebSocket<WSData>>;
  eventBuffer: EventBuffer;
  translator: TranslatorState;
  pendingApprovals: Map<string, PendingApproval>;
  /** Last assigned outbound seq for this session. Monotonic per session. */
  lastSeq: number;
  /** Unix epoch ms of last outbound activity. */
  lastActivity: number;
  /** Latest StatusUpdate seen this turn; flushed to sessions.totalTokens at turn end. */
  lastStatusUpdate: StatusUpdatePayload | null;
  /** Maps tool_call.id → tool name; consumed when the matching tool_result fires. */
  toolNameByCallId: Map<string, string>;
  /**
   * Per-session mutex chain serializing `backupAfterTurn`. The pump appends
   * `await backupMutex` to a chained promise so concurrent post-turn flushes
   * (should never happen in 5a but defensive against future steering paths)
   * cannot interleave `wireByteOffset` updates.
   */
  backupMutex: Promise<void>;
  /**
   * @internal Synchronous "close in progress" flag. Read/written ONLY through
   * `KimiSessionManager.tryBeginClose`. Pure event-loop semantics — no atomics.
   */
  closing: boolean;
}

export interface RegisterArgs {
  sessionId: string;
  userId: string;
  workDir: string;
  kimiSessionId: string;
  kimiSession: Session;
  bufferCapacity?: number;
}

export type RestoreFn = (sessionId: string) => Promise<ActiveSession>;

export class KimiSessionManager {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly byUser = new Map<string, Set<string>>();
  /** In-flight restore promises keyed by sessionId — invariant #3. */
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
      kimiSessionId: args.kimiSessionId,
      kimiSession: args.kimiSession,
      currentTurn: null,
      wsSet: new Set(),
      eventBuffer: createEventBuffer(args.bufferCapacity),
      translator: createTranslatorState(),
      pendingApprovals: new Map(),
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

  /** Remove a session from both maps. Caller is responsible for SDK close(). */
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

  /** True iff sessionId exists in memory regardless of owner. Internal use. */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Atomically claim teardown ownership for `sessionId`. Returns `true` for
   * the winning caller, `false` for any concurrent loser or for sessions that
   * are already gone. Sets `active.closing = true` synchronously — pure event-
   * loop semantics, no atomics.
   *
   * Caller is responsible for the rest of teardown (drain, SDK close, DB
   * update, broadcast, audit, unregister).
   */
  tryBeginClose(sessionId: string): boolean {
    const active = this.sessions.get(sessionId);
    if (!active || active.closing) return false;
    active.closing = true;
    return true;
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
   * handler — pump keeps running, just no more sockets to fan out to. Returns
   * the count of sessions touched (for diagnostics).
   */
  detachAllWS(ws: ServerWebSocket<WSData>): number {
    let touched = 0;
    for (const active of this.sessions.values()) {
      if (active.wsSet.delete(ws)) touched += 1;
    }
    return touched;
  }

  /**
   * Lazy lookup with shared in-flight cache (invariant #3). If the session is
   * already in memory and owned by `userId`, return it immediately. Otherwise
   * call `restore(sessionId)` exactly once for concurrent waiters; on success,
   * compare ownership and return null on mismatch (uniform `not_found`).
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
export const sessionManager = new KimiSessionManager();
