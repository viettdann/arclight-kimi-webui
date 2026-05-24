import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ServerWebSocket } from 'bun';
import type {
  AnswerQuestionPayload,
  ApprovalResponse,
  ApproveToolPayload,
  CreateSessionPayload,
  ErrorPayload,
  ReplayDonePayload,
  ResumeSessionPayload,
  SendMessagePayload,
  SessionStatePayload,
  SteerInputPayload,
  SubscribePayload,
  WSMessage,
  WSMessageType,
} from 'shared/types';
import { validateAuthSession } from '../auth/session-check';
import { type DB, db, schema } from '../db';
import { env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { broadcastEvent, sendDirect } from '../lib/ws-broadcast';
import { loadEnvForInjection } from '../services/kimi-config/env-injection';
import { createKimi, pumpTurn, restoreFromBackup } from '../services/kimi-session';
import { clearPendingPrompt, enqueuePendingPrompt } from '../services/pending-prompts';
import { closeActiveSession } from '../services/session-lifecycle';
import {
  type ActiveSession,
  sessionManager as defaultManager,
  type KimiSessionManager,
} from '../services/session-manager';
import { buildSnapshot } from '../services/snapshot';
import { closeAuthExpired } from './close-codes';
import { WS_HEARTBEAT_MS } from './heartbeat';
import type { WSData } from './upgrade';

type RestoreInjection = (
  sessionId: string,
  manager: KimiSessionManager,
  db: DB,
) => Promise<ActiveSession>;

type CreateKimiInjection = typeof createKimi;

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
  createKimi: CreateKimiInjection;
}

const defaultRestore: RestoreInjection = (sessionId, mgr, dbh) =>
  restoreFromBackup({ sessionId, manager: mgr, db: dbh });

let deps: HandlerDeps = {
  db,
  manager: defaultManager,
  restore: defaultRestore,
  auditLog: defaultAuditLog,
  createKimi,
};

/** Test seam: swap module-level deps. Pass `null` to reset to defaults. */
export function setHandlerDeps(next: Partial<HandlerDeps> | null): void {
  if (next === null) {
    deps = {
      db,
      manager: defaultManager,
      restore: defaultRestore,
      auditLog: defaultAuditLog,
      createKimi,
    };
    return;
  }
  deps = {
    db: next.db ?? db,
    manager: next.manager ?? defaultManager,
    restore: next.restore ?? defaultRestore,
    auditLog: next.auditLog ?? defaultAuditLog,
    createKimi: next.createKimi ?? createKimi,
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

// TTL aligned with the heartbeat: after each cycle stamps `lastValidatedAt`,
// the next heartbeat is the next refresh — keeping TTL ≤ heartbeat would
// force redundant DB lookups for messages arriving between cycles.
const REVALIDATE_TTL_MS = WS_HEARTBEAT_MS;

/**
 * Slow-path revalidation — only called when the per-WS TTL has expired.
 * On DB error returns true (transient): the heartbeat is the authoritative
 * checker and will close the socket on the next cycle if the session is
 * truly gone. Closing the socket on every transient DB blip would punish
 * users for an outage they cannot fix.
 */
async function revalidateAuthSession(ws: WS): Promise<boolean> {
  let valid = false;
  try {
    valid = await validateAuthSession(ws.data.authSessionId, deps.db);
  } catch (err) {
    logger.error({ err, authSessionId: ws.data.authSessionId }, 'revalidateAuthSession: db error');
    return true;
  }
  if (!valid) {
    closeAuthExpired(ws);
    return false;
  }
  ws.data.lastValidatedAt = Date.now();
  return true;
}

export async function handleMessage(ws: WS, raw: string | Buffer): Promise<void> {
  // Sync fast-path — avoids a microtask + Promise allocation on every WS frame.
  if (Date.now() - ws.data.lastValidatedAt >= REVALIDATE_TTL_MS) {
    if (!(await revalidateAuthSession(ws))) return;
  }
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
      case 'answer_question':
        await handleAnswerQuestion(
          ws,
          sessionId,
          parsed.payload as AnswerQuestionPayload | undefined,
        );
        return;
      case 'steer_input':
        await handleSteerInput(ws, sessionId, parsed.payload as SteerInputPayload | undefined);
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

  const envVars = await loadEnvForInjection(deps.db);

  let kimi: ReturnType<typeof createKimi>;
  try {
    kimi = deps.createKimi({
      workDir,
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.thinking != null ? { thinking: payload.thinking } : {}),
      ...(payload.yoloMode != null ? { yoloMode: payload.yoloMode } : {}),
      env: envVars,
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
    yoloMode: payload.yoloMode ?? false,
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
    { blocks: [], status: 'active', totalTokens: 0, title: null, pendingPrompt: null },
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
  await enqueuePendingPrompt(active.sessionId, payload.content, deps.db);
  let turn;
  try {
    turn = active.kimiSession.prompt(payload.content);
  } catch (err) {
    await clearPendingPrompt(active.sessionId, deps.db);
    throw err;
  }
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

function isStringRecord(v: unknown): v is Record<string, string> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== 'string') return false;
  }
  return true;
}

async function handleAnswerQuestion(
  ws: WS,
  sessionId: string,
  payload: AnswerQuestionPayload | undefined,
): Promise<void> {
  if (!sessionId) {
    sendError(ws, 'bad_request');
    return;
  }
  if (!payload || typeof payload.requestId !== 'string' || !isStringRecord(payload.answers)) {
    sendError(ws, 'bad_request', sessionId);
    return;
  }
  const active = deps.manager.getForUser(ws.data.userId, sessionId);
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  const pending = active.pendingQuestions.get(payload.requestId);
  if (!pending) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  try {
    // SDK signature: respondQuestion(rpcRequestId, questionRequestId, answers).
    // Per assumption A1 the two ids are equal — both round-tripped from the
    // wire `QuestionRequest.id`.
    await pending.turn.respondQuestion(
      pending.rpcRequestId,
      pending.questionRequestId,
      payload.answers,
    );
  } catch (err) {
    logger.error({ err, sessionId, requestId: payload.requestId }, 'respondQuestion failed');
    sendError(ws, 'answer_failed', sessionId, 'failed to forward answer to agent', true);
    return;
  }
  active.pendingQuestions.delete(payload.requestId);
}

async function handleSteerInput(
  ws: WS,
  sessionId: string,
  payload: SteerInputPayload | undefined,
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
  if (active.currentTurn === null) {
    sendError(ws, 'no_turn', sessionId);
    return;
  }
  try {
    await active.currentTurn.steer(payload.content);
  } catch (err) {
    logger.error({ err, sessionId }, 'steer failed');
    sendError(ws, 'steer_failed', sessionId, 'failed to steer turn', true);
  }
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
    const snap = await buildSnapshot({
      sessionId: active.sessionId,
      manager: deps.manager,
      db: deps.db,
    });
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
