import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CliErrorCodes, getErrorCode } from '@moonshot-ai/kimi-agent-sdk';
import type { ServerWebSocket } from 'bun';
import { eq } from 'drizzle-orm';
import type {
  AdoptProjectPayload,
  AnswerQuestionPayload,
  ApprovalMode,
  ApprovalResponse,
  ApproveToolPayload,
  CreateSessionPayload,
  ErrorPayload,
  ProjectAdoptedPayload,
  ReplayDonePayload,
  ResumeSessionPayload,
  SendMessagePayload,
  SessionCreatedPayload,
  SlashCommand,
  SlashCommandsPayload,
  SnapshotPayload,
  SteerInputPayload,
  SubscribePayload,
  WSMessage,
  WSMessageType,
} from 'shared/types';
import { APPROVAL_MODES } from 'shared/types';
import { validateAuthSession } from '../auth/session-check';
import { type DB, db, schema } from '../db';
import { logDbError } from '../db/errors';
import { env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { slugifyProjectName } from '../lib/slug';
import { broadcastEvent, sendDirect } from '../lib/ws-broadcast';
import { buildEnvFromRow } from '../services/kimi-config/env';
import { getKimiConfig } from '../services/kimi-config/get-kimi-config';
import {
  createKimi,
  flushContextAndState,
  pumpTurn,
  restoreFromBackup,
} from '../services/kimi-session';
import { clearPendingPrompt, enqueuePendingPrompt } from '../services/pending-prompts';
import { adoptProjectForUser, ProjectNotFoundError } from '../services/projects';
import {
  type ActiveSession,
  sessionManager as defaultManager,
  type KimiSessionManager,
} from '../services/session-manager';
import { getSlashCommands } from '../services/slash-commands-cache';
import { buildSnapshot, emptySnapshot } from '../services/snapshot';
import { deriveProjectName } from '../services/work-dir';
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
const VALID_APPROVAL_MODE: ReadonlySet<string> = new Set(APPROVAL_MODES);

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
    logDbError(logger, err, { authSessionId: ws.data.authSessionId }, 'revalidateAuthSession');
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
      case 'adopt_project':
        await handleAdoptProject(ws, parsed.payload as AdoptProjectPayload | undefined);
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
  if (payload.approvalMode !== undefined && !VALID_APPROVAL_MODE.has(payload.approvalMode)) {
    sendError(ws, 'bad_request');
    return;
  }
  const workDir = validateWorkDir(ws.data.userSlug, payload.workDir);
  if (workDir === null) {
    sendError(ws, 'bad_request');
    return;
  }
  const userRoot = path.resolve(env.WORKSPACE_ROOT, ws.data.userSlug);
  const projectName = deriveProjectName(userRoot, workDir);
  if (projectName === null) {
    sendError(ws, 'bad_request');
    return;
  }
  if (projectName !== slugifyProjectName(projectName)) {
    sendError(ws, 'bad_request');
    return;
  }

  // Single read of the singleton config row; both env injection and the
  // thinking/yolo defaults derive from it. Avoids two SELECTs per create_session.
  let cfgRow: Awaited<ReturnType<typeof getKimiConfig>> | null = null;
  try {
    cfgRow = await getKimiConfig(deps.db);
  } catch {
    // Config table may be absent in test fakes; fall through to defaults.
  }
  const envVars = cfgRow ? buildEnvFromRow(cfgRow) : {};
  const cfgDefaults = cfgRow
    ? { thinking: cfgRow.defaults.thinking, yolo: cfgRow.defaults.yolo }
    : null;
  // Thinking is on by default: payload wins, else configured default, else true.
  const thinking = payload.thinking ?? cfgDefaults?.thinking ?? true;
  // approvalMode is the source of truth: explicit payload wins, else derive
  // from the legacy yolo flag (payload or configured default). yoloMode forwarded
  // to the SDK is then derived from the resolved mode.
  const yoloDefault = payload.yoloMode ?? cfgDefaults?.yolo ?? false;
  const approvalMode: ApprovalMode = payload.approvalMode ?? (yoloDefault ? 'yolo' : 'ask');
  const sdkYolo = approvalMode === 'yolo';

  let kimi: ReturnType<typeof createKimi>;
  try {
    kimi = deps.createKimi({
      workDir,
      ...(payload.model ? { model: payload.model } : {}),
      thinking,
      yoloMode: sdkYolo,
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
  await deps.db.insert(schema.kimiSessions).values({
    id: sessionRowId,
    userId: ws.data.userId,
    workDir,
    projectName,
    model: payload.model ?? null,
    thinking,
    yoloMode: sdkYolo,
    approvalMode,
    kimiSessionId,
    title: null,
  });

  const active = deps.manager.register({
    sessionId: sessionRowId,
    userId: ws.data.userId,
    workDir,
    kimiSessionId,
    kimiSession: kimi,
    approvalMode,
  });
  deps.manager.attachWS(active, ws);

  // Seed session_files immediately so a server restart before any turn
  // doesn't leave this row as a zombie (active in `sessions` but no backup row).
  // restoreFromBackup keys off the existence of this row.
  try {
    await flushContextAndState(active, deps.db);
  } catch (err) {
    logger.warn({ err, sessionId: sessionRowId }, 'initial session_files seed failed');
  }

  // Warm-init the slash-command picker for this workDir. Best-effort: a failed
  // probe just leaves the picker empty — the session is still fully usable.
  let slashCommands: SlashCommand[] = [];
  try {
    slashCommands = await getSlashCommands(workDir, { env: envVars });
  } catch {
    // picker stays empty
  }

  broadcastEvent<SessionCreatedPayload>(active, 'session_created', {}, deps.manager);
  // Carry the resolved flags + slashCommands in the snapshot so reload/resume
  // restores the picker and the approval/thinking selectors to true state.
  const snap = emptySnapshot();
  snap.thinking = thinking;
  snap.yoloMode = sdkYolo;
  snap.approvalMode = approvalMode;
  snap.slashCommands = slashCommands;
  broadcastEvent<SnapshotPayload>(active, 'snapshot', snap, deps.manager);
  broadcastEvent<SlashCommandsPayload>(
    active,
    'slash_commands',
    { commands: slashCommands },
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
  // Apply composer flags that ride along with the send. Only fields that
  // actually flip are written — a resend with unchanged flags is a no-op, so
  // there is nothing to spam. The SDK reads thinking/yoloMode when the prompt
  // below spawns the turn, so this is the right moment to commit them.
  if (
    (payload.thinking !== undefined && typeof payload.thinking !== 'boolean') ||
    (payload.yoloMode !== undefined && typeof payload.yoloMode !== 'boolean') ||
    (payload.approvalMode !== undefined && !VALID_APPROVAL_MODE.has(payload.approvalMode))
  ) {
    sendError(ws, 'bad_request', sessionId);
    return;
  }
  // approvalMode is the source of truth. A client that sends only `yoloMode`
  // (legacy composer) maps to a mode; the resolved mode then derives the SDK
  // yolo flag. Omitting both leaves the session unchanged.
  const nextMode: ApprovalMode | undefined =
    payload.approvalMode ??
    (payload.yoloMode !== undefined ? (payload.yoloMode ? 'yolo' : 'ask') : undefined);

  const flagChanges: { thinking?: boolean; yoloMode?: boolean; approvalMode?: ApprovalMode } = {};
  if (payload.thinking !== undefined && payload.thinking !== active.kimiSession.thinking) {
    flagChanges.thinking = payload.thinking;
  }
  if (nextMode !== undefined && nextMode !== active.approvalMode) {
    flagChanges.approvalMode = nextMode;
  }
  const sdkYolo = nextMode === 'yolo';
  if (nextMode !== undefined && sdkYolo !== active.kimiSession.yoloMode) {
    flagChanges.yoloMode = sdkYolo;
  }
  if (
    flagChanges.thinking !== undefined ||
    flagChanges.yoloMode !== undefined ||
    flagChanges.approvalMode !== undefined
  ) {
    // Mirror the SDK-facing flags onto the live session and the in-memory tier
    // before prompt() spawns the turn. The DB write persists all three.
    if (flagChanges.thinking !== undefined) active.kimiSession.thinking = flagChanges.thinking;
    if (flagChanges.yoloMode !== undefined) active.kimiSession.yoloMode = flagChanges.yoloMode;
    if (flagChanges.approvalMode !== undefined) active.approvalMode = flagChanges.approvalMode;
    await deps.db
      .update(schema.kimiSessions)
      .set(flagChanges)
      .where(eq(schema.kimiSessions.id, sessionId));
  }
  await enqueuePendingPrompt(active.sessionId, payload.content, deps.db);
  let turn: ReturnType<typeof active.kimiSession.prompt>;
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
  // Snapshot the turn before the null check so the post-await deref doesn't
  // depend on `active.currentTurn` still being set by the time we resume —
  // the pump may have cleared it during the await window.
  const turn = active.currentTurn;
  if (turn === null) return;
  try {
    await turn.interrupt();
  } catch (err) {
    // Race: SDK already finalised the turn while the pump was still wrapping
    // up (clearing currentTurn, broadcasting turn_end). The user's intent
    // (stop the turn) is already satisfied — silently no-op instead of
    // surfacing a confusing `internal` error.
    if (getErrorCode(err) === CliErrorCodes.INVALID_STATE) {
      logger.info(
        { sessionId, err: err instanceof Error ? err.message : String(err) },
        'interrupt_turn: SDK already idle, treating as no-op',
      );
      return;
    }
    throw err;
  }
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

  // After a server restart the warm-init cache is empty, so the snapshot above
  // carried no slash commands. Re-warm in the background (detached — never
  // block reconnect) and broadcast the list once it lands. Cache hit returns
  // immediately and re-broadcasts the same list, which is harmless.
  if (needSnapshot) {
    void getSlashCommands(active.workDir)
      .then((commands) => {
        if (commands.length === 0) return;
        broadcastEvent<SlashCommandsPayload>(active, 'slash_commands', { commands }, deps.manager);
      })
      .catch((err) => {
        logger.warn(
          { err, sessionId: active.sessionId },
          'reconnect slash-commands warm-init failed',
        );
      });
  }
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

async function handleAdoptProject(ws: WS, payload: AdoptProjectPayload | undefined): Promise<void> {
  if (!payload || typeof payload.projectName !== 'string') {
    sendError(ws, 'bad_request');
    return;
  }
  const projectName = payload.projectName;
  if (projectName !== slugifyProjectName(projectName)) {
    sendError(ws, 'bad_request');
    return;
  }

  let result: Awaited<ReturnType<typeof adoptProjectForUser>>;
  try {
    result = await adoptProjectForUser({
      userId: ws.data.userId,
      userSlug: ws.data.userSlug,
      projectName,
      db: deps.db,
      env,
    });
  } catch (err) {
    const code = err instanceof ProjectNotFoundError ? 'not_found' : 'internal';
    logger.warn({ err, projectName }, 'adopt_project failed');
    sendError(ws, code);
    return;
  }

  sendDirect(
    ws,
    envelope<ProjectAdoptedPayload>(
      'project_adopted',
      {
        projectName: result.projectName,
        workDir: result.workDir,
        sessionCount: result.sessionCount,
      },
      '',
    ),
  );
}
