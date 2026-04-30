import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ServerWebSocket } from 'bun';
import type {
  ApprovalResponse,
  ApproveToolPayload,
  CreateSessionPayload,
  ErrorPayload,
  ReplayDonePayload,
  ResumeSessionPayload,
  SendMessagePayload,
  SessionStatePayload,
  SubscribePayload,
  WSMessage,
  WSMessageType,
} from 'shared/types';
import { type DB, db, schema } from '../db';
import { env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { broadcastEvent, sendDirect } from '../lib/ws-broadcast';
import { createKimi, pumpTurn, restoreFromBackup } from '../services/kimi-session';
import { insertUserMessage } from '../services/messages';
import { closeActiveSession } from '../services/session-lifecycle';
import {
  type ActiveSession,
  sessionManager as defaultManager,
  type KimiSessionManager,
} from '../services/session-manager';
import { buildSnapshot } from '../services/snapshot';
import type { WSData } from './upgrade';

type RestoreInjection = (
  sessionId: string,
  manager: KimiSessionManager,
  db: DB,
) => Promise<ActiveSession>;

// Client→server WS message handlers. Single dispatcher entrypoint
// `handleMessage(ws, raw)`; each branch covers one client message type.
//
// Module-level singletons (`db`, `defaultManager`) are wired by default; tests
// inject overrides via `setHandlerDeps`. `setHandlerDeps` is intentionally
// minimal — it does not own the lifecycle of the singletons, just lets tests
// substitute fakes for the duration of a describe block.

type WS = ServerWebSocket<WSData>;

interface IncomingMessage {
  type?: unknown;
  payload?: unknown;
  sessionId?: unknown;
}

const VALID_APPROVAL: ReadonlySet<string> = new Set(['approve', 'approve_for_session', 'reject']);

interface HandlerDeps {
  db: DB;
  manager: KimiSessionManager;
  restore: RestoreInjection;
  auditLog: typeof defaultAuditLog;
}

const defaultRestore: RestoreInjection = (sessionId, mgr, dbh) =>
  restoreFromBackup({ sessionId, manager: mgr, db: dbh });

let deps: HandlerDeps = {
  db,
  manager: defaultManager,
  restore: defaultRestore,
  auditLog: defaultAuditLog,
};

/** Test seam: swap module-level deps. Pass `null` to reset to defaults. */
export function setHandlerDeps(next: Partial<HandlerDeps> | null): void {
  if (next === null) {
    deps = {
      db,
      manager: defaultManager,
      restore: defaultRestore,
      auditLog: defaultAuditLog,
    };
    return;
  }
  deps = {
    db: next.db ?? db,
    manager: next.manager ?? defaultManager,
    restore: next.restore ?? defaultRestore,
    auditLog: next.auditLog ?? defaultAuditLog,
  };
}

/** Build a not-yet-buffered, no-seq WS message envelope. */
function envelope<T>(type: WSMessageType, payload: T, sessionId: string): WSMessage<T> {
  return { type, payload, sessionId, seq: 0, timestamp: Date.now() };
}

function sendError(
  ws: WS,
  code: string,
  sessionId = '',
  message?: string,
  retryable = false,
): void {
  const errMsg = envelope<ErrorPayload>(
    'error',
    { code, message: message ?? code, retryable },
    sessionId,
  );
  sendDirect(ws, errMsg);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Loose workspace prefix check. Plan §"create_session" — full path-guard
 * (NUL, symlink, realpath escape) is deferred to MVP-6. For now we only
 * confirm the requested workDir is absolute and lives under
 * `${WORKSPACE_ROOT}/${userSlug}` (matches dir layout created by auth +
 * routes/files). Returns the resolved abs path or `null`.
 */
function validateWorkDir(userSlug: string, workDir: unknown): string | null {
  if (typeof workDir !== 'string' || workDir.length === 0) return null;
  if (!path.isAbsolute(workDir)) return null;
  if (workDir.includes('\0')) return null;
  const userRoot = path.resolve(env.WORKSPACE_ROOT, userSlug);
  const normalized = path.resolve(workDir);
  if (normalized !== userRoot && !normalized.startsWith(`${userRoot}${path.sep}`)) {
    return null;
  }
  return normalized;
}

export async function handleMessage(ws: WS, raw: string | Buffer): Promise<void> {
  let parsed: IncomingMessage;
  try {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    parsed = JSON.parse(text) as IncomingMessage;
  } catch {
    sendError(ws, 'bad_message');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    sendError(ws, 'bad_message');
    return;
  }

  const sessionId = asString(parsed.sessionId) ?? '';

  try {
    switch (parsed.type as WSMessageType) {
      case 'create_session':
        await handleCreateSession(ws, parsed.payload as CreateSessionPayload | undefined);
        return;
      case 'subscribe':
        await handleSubscribe(ws, parsed.payload as SubscribePayload | undefined);
        return;
      case 'resume_session':
        await handleResumeSession(ws, parsed.payload as ResumeSessionPayload | undefined);
        return;
      case 'send_message':
        await handleSendMessage(ws, sessionId, parsed.payload as SendMessagePayload | undefined);
        return;
      case 'approve_tool':
        await handleApproveTool(ws, sessionId, parsed.payload as ApproveToolPayload | undefined);
        return;
      case 'interrupt_turn':
        await handleInterruptTurn(ws, sessionId);
        return;
      case 'close_session':
        await handleCloseSession(ws, sessionId);
        return;
      default:
        sendError(ws, 'bad_message', sessionId, `unknown type: ${String(parsed.type)}`);
    }
  } catch (err) {
    logger.error({ err, type: parsed.type, sessionId }, 'ws handler error');
    sendError(ws, 'internal', sessionId);
  }
}

// ─────────────────────────── 5a handlers ───────────────────────────

async function handleCreateSession(
  ws: WS,
  payload: CreateSessionPayload | undefined,
): Promise<void> {
  if (!payload || typeof payload !== 'object') {
    sendError(ws, 'bad_request');
    return;
  }
  const workDir = validateWorkDir(ws.data.userSlug, payload.workDir);
  if (workDir === null) {
    sendError(ws, 'bad_request');
    return;
  }

  let kimi: ReturnType<typeof createKimi>;
  try {
    kimi = createKimi({
      workDir,
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.thinking != null ? { thinking: payload.thinking } : {}),
    });
  } catch (err) {
    logger.error({ err, workDir }, 'createSession failed');
    sendError(ws, 'session_create_failed');
    return;
  }

  const kimiSessionId = kimi.sessionId;
  const sessionRowId = randomUUID();

  // Insert AFTER createSession succeeded — no orphan rows on SDK throw.
  await deps.db.insert(schema.sessions).values({
    id: sessionRowId,
    userId: ws.data.userId,
    workDir,
    model: payload.model ?? null,
    thinking: payload.thinking ?? false,
    status: 'active',
    kimiSessionId,
    title: null,
  });

  const active = deps.manager.register({
    sessionId: sessionRowId,
    userId: ws.data.userId,
    workDir,
    kimiSessionId,
    kimiSession: kimi,
  });
  deps.manager.attachWS(active, ws);

  broadcastEvent<SessionStatePayload>(active, 'session_state', { state: 'active' }, deps.manager);
  broadcastEvent(
    active,
    'snapshot',
    { messages: [], status: 'active', totalTokens: 0, title: null },
    deps.manager,
  );
  sendDirect(
    ws,
    envelope<ReplayDonePayload>('replay_done', { lastSeq: active.lastSeq }, active.sessionId),
  );
}

async function handleSendMessage(
  ws: WS,
  sessionId: string,
  payload: SendMessagePayload | undefined,
): Promise<void> {
  if (!sessionId) {
    sendError(ws, 'bad_request');
    return;
  }
  if (!payload || typeof payload.content !== 'string' || payload.content.length === 0) {
    sendError(ws, 'bad_request', sessionId);
    return;
  }
  const active = deps.manager.getForUser(ws.data.userId, sessionId);
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  if (active.currentTurn !== null) {
    sendError(ws, 'turn_in_progress', sessionId);
    return;
  }
  await insertUserMessage({
    sessionId: active.sessionId,
    content: payload.content,
    db: deps.db,
  });
  const turn = active.kimiSession.prompt(payload.content);
  active.currentTurn = turn;
  // Pump runs detached. Errors are caught inside pumpTurn and surfaced as
  // `error` events; awaiting here would block the dispatcher and stall the
  // socket. invariant #1: backup mutex inside pump serializes writes.
  void pumpTurn(active, turn, { manager: deps.manager, db: deps.db }).catch((err) => {
    logger.error({ err, sessionId: active.sessionId }, 'pumpTurn rejected unexpectedly');
  });
}

async function handleApproveTool(
  ws: WS,
  sessionId: string,
  payload: ApproveToolPayload | undefined,
): Promise<void> {
  if (!sessionId) {
    sendError(ws, 'bad_request');
    return;
  }
  if (!payload || typeof payload.requestId !== 'string' || typeof payload.response !== 'string') {
    sendError(ws, 'bad_request', sessionId);
    return;
  }
  if (!VALID_APPROVAL.has(payload.response)) {
    sendError(ws, 'bad_request', sessionId);
    return;
  }
  const active = deps.manager.getForUser(ws.data.userId, sessionId);
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  const pending = active.pendingApprovals.get(payload.requestId);
  if (!pending) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  // SDK signature is positional: turn.approve(requestId, response).
  await pending.turn.approve(pending.requestId, payload.response as ApprovalResponse);
  active.pendingApprovals.delete(payload.requestId);
}

async function handleInterruptTurn(ws: WS, sessionId: string): Promise<void> {
  if (!sessionId) {
    sendError(ws, 'bad_request');
    return;
  }
  const active = deps.manager.getForUser(ws.data.userId, sessionId);
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  if (active.currentTurn !== null) {
    await active.currentTurn.interrupt();
  }
}

async function handleCloseSession(ws: WS, sessionId: string): Promise<void> {
  if (!sessionId) {
    sendError(ws, 'bad_request');
    return;
  }
  const active = deps.manager.getForUser(ws.data.userId, sessionId);
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  // Defer to the shared lifecycle helper — same teardown order as REST.
  // Helper does NOT close attached sockets; clients receive
  // `session_state{closed, reason:'ws'}` and decide whether to drop the socket.
  await closeActiveSession(
    active,
    { manager: deps.manager, db: deps.db, auditLog: deps.auditLog },
    { reason: 'ws' },
  );
}

// ─────────────────────────── 5b handlers ───────────────────────────

async function reconnect(
  ws: WS,
  sessionId: string,
  forceSnapshot: boolean,
  lastSeq: number | undefined,
): Promise<ActiveSession | null> {
  const active = await deps.manager.getOrRestore(ws.data.userId, sessionId, (sid) =>
    deps.restore(sid, deps.manager, deps.db),
  );
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return null;
  }
  deps.manager.attachWS(active, ws);

  const buffer = active.eventBuffer;
  const gap = lastSeq == null ? Number.POSITIVE_INFINITY : active.lastSeq - lastSeq;
  // - lastSeq omitted → snapshot
  // - gap > capacity → too far behind; buffer cannot serve
  // - gap < 0 → client ahead of server (server restart); resync via snapshot
  const needSnapshot = forceSnapshot || lastSeq == null || gap > buffer.capacity || gap < 0;

  if (needSnapshot) {
    const snap = await buildSnapshot({ sessionId: active.sessionId, db: deps.db });
    if (!snap) {
      sendError(ws, 'not_found', sessionId);
      return null;
    }
    broadcastEvent(active, 'snapshot', snap, deps.manager);
  } else {
    const diff = buffer.since(lastSeq as number);
    for (const msg of diff) {
      sendDirect(ws, msg);
    }
  }
  sendDirect(
    ws,
    envelope<ReplayDonePayload>('replay_done', { lastSeq: active.lastSeq }, active.sessionId),
  );
  return active;
}

async function handleSubscribe(ws: WS, payload: SubscribePayload | undefined): Promise<void> {
  if (!payload || typeof payload.sessionId !== 'string') {
    sendError(ws, 'bad_request');
    return;
  }
  const lastSeq =
    typeof payload.lastSeq === 'number' && Number.isFinite(payload.lastSeq)
      ? payload.lastSeq
      : undefined;
  await reconnect(ws, payload.sessionId, false, lastSeq);
}

async function handleResumeSession(
  ws: WS,
  payload: ResumeSessionPayload | undefined,
): Promise<void> {
  if (!payload || typeof payload.sessionId !== 'string') {
    sendError(ws, 'bad_request');
    return;
  }
  await reconnect(ws, payload.sessionId, true, undefined);
}
