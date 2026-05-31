import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ServerWebSocket } from 'bun';
import { eq } from 'drizzle-orm';
import type {
  AdoptProjectPayload,
  AnswerQuestionPayload,
  ApprovalMode,
  ApproveToolPayload,
  CreateSessionPayload,
  EffortLevel,
  ErrorPayload,
  ProjectAdoptedPayload,
  ReplayDonePayload,
  ResumeSessionPayload,
  SendMessagePayload,
  SessionCreatedPayload,
  SessionUpdatedPayload,
  SnapshotPayload,
  SubscribePayload,
  TurnBeginPayload,
  WSMessage,
  WSMessageType,
} from 'shared/types';
import { APPROVAL_MODES, EFFORT_LEVELS } from 'shared/types';
import { validateAuthSession } from '../auth/session-check';
import { type DB, db, schema } from '../db';
import { logDbError } from '../db/errors';
import { env } from '../env';
import { auditLog as defaultAuditLog, logger } from '../lib/logger';
import { slugifyProjectName } from '../lib/slug';
import { broadcastEvent, sendDirect } from '../lib/ws-broadcast';
import { tryHandleSlashCommand } from '../services/agent/commands';
import { createMessageBridge } from '../services/agent/message-bridge';
import { consumeQueryOutput } from '../services/agent/output-consumer';
import { startQuery } from '../services/agent/query-runner';
import { restoreTranscript } from '../services/agent/transcript-store';
import { adoptProjectForUser, ProjectNotFoundError } from '../services/projects';
import {
  defaultSelectionForUser,
  ProviderUnavailableError,
  resolveProviderForUser,
} from '../services/providers/resolve';
import {
  type ActiveSession,
  sessionManager as defaultManager,
  type SessionManager,
} from '../services/session-manager';
import { buildSnapshot } from '../services/snapshot';
import { deriveProjectName } from '../services/work-dir';
import { closeAuthExpired } from './close-codes';
import { WS_HEARTBEAT_MS } from './heartbeat';
import type { WSData } from './upgrade';

// Client→server WS message handlers. Single dispatcher entrypoint
// `handleMessage(ws, raw)`; each branch covers one client message type.
//
// Resource model: a Claude `query` spawns a `claude` subprocess. We never spawn
// one merely to VIEW a session — subscribe/resume bring the session into memory
// and restore its transcript but leave `query` null. The subprocess is spawned
// lazily by `ensureQuery`, on the first real `send_message`.
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
const VALID_EFFORT: ReadonlySet<string> = new Set(EFFORT_LEVELS);

// Effort is invalid only when present and not a known level. `null` (reset to
// provider default) and `undefined` (unchanged) are both allowed.
function isInvalidEffort(effort: EffortLevel | null | undefined): boolean {
  return effort !== undefined && effort !== null && !VALID_EFFORT.has(effort);
}

/**
 * Restore an idle session into memory. Loads the `sessions` row (authz: must
 * belong to `userId`), replays the persisted transcript to disk so the binary
 * can `resume` from it, and registers an in-memory slot — WITHOUT starting a
 * query. The subprocess is spawned lazily on the first `send_message`.
 *
 * Throws when the row is missing or owned by another user; `getOrRestore` maps
 * the throw to a uniform `not_found`.
 */
type RestoreInjection = (
  sessionId: string,
  manager: SessionManager,
  db: DB,
) => Promise<ActiveSession>;

interface HandlerDeps {
  db: DB;
  manager: SessionManager;
  restore: RestoreInjection;
  auditLog: typeof defaultAuditLog;
}

const defaultRestore: RestoreInjection = async (sessionId, mgr, dbh) => {
  const [row] = await dbh
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!row) throw new Error(`session ${sessionId} not found`);

  await restoreTranscript(sessionId);

  const active = mgr.register({
    sessionId: row.id,
    userId: row.userId,
    workDir: row.workDir,
    model: row.model,
    providerId: row.providerId,
    thinking: row.thinking,
    approvalMode: row.approvalMode as ApprovalMode,
    effort: (row.effort as EffortLevel | null) ?? null,
  });
  // Carry the persisted SDK session id so the lazy query can `resume`.
  active.sdkSessionId = row.sdkSessionId ?? null;
  return active;
};

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

/** Map the wire approval mode to the SDK `PermissionMode`. */
function mapMode(mode: ApprovalMode): 'default' | 'acceptEdits' | 'bypassPermissions' {
  switch (mode) {
    case 'safe':
      return 'acceptEdits';
    case 'bypass':
      return 'bypassPermissions';
    default:
      return 'default';
  }
}

/**
 * Loose workspace prefix check. Confirms the requested workDir is absolute and
 * lives under `${WORKSPACE_ROOT}/${userSlug}` (matches the dir layout created by
 * auth + routes/files). Returns the resolved abs path or `null`.
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

/**
 * Lazily spawn the SDK query (and its `claude` subprocess) for a session. Wires
 * the streaming-input bridge as the prompt source, starts the long-running
 * output consumer fire-and-forget, and resumes from the persisted SDK session
 * id when present. Idempotent — a no-op if a query is already live, so multiple
 * `send_message` turns reuse the single subprocess.
 */
async function ensureQuery(active: ActiveSession): Promise<void> {
  if (active.query) return;
  active.bridge = createMessageBridge(active.sessionId);
  await startQuery(active, {
    prompt: active.bridge.iterable,
    resume: active.sdkSessionId ?? null,
  });
  // Detached: the consumer runs for the session lifetime. Any unexpected
  // rejection surfaces as an `error` event and clears the in-flight flag.
  void consumeQueryOutput(active).catch((err) => {
    logger.error({ err, sessionId: active.sessionId }, 'output consumer rejected unexpectedly');
    active.turnInProgress = false;
    broadcastEvent<ErrorPayload>(
      active,
      'error',
      {
        code: 'consumer_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
      deps.manager,
    );
  });
}

/** Build a `snapshot` envelope carrying the current lastSeq as the wire seq. */
function snapshotEnvelope(
  active: ActiveSession,
  snap: SnapshotPayload,
): WSMessage<SnapshotPayload> {
  return {
    type: 'snapshot',
    payload: snap,
    sessionId: active.sessionId,
    seq: active.lastSeq,
    timestamp: Date.now(),
  };
}

/**
 * Snapshot-only attach. The snapshot REPLACES the client's block list, so we
 * never also replay buffered events — that would double-apply appends. The live
 * broadcast stream plus the `final:true` commits keep the client current after
 * attach.
 */
async function sendSnapshot(ws: WS, active: ActiveSession): Promise<boolean> {
  const snap = await buildSnapshot({
    sessionId: active.sessionId,
    manager: deps.manager,
    db: deps.db,
  });
  if (!snap) {
    sendError(ws, 'not_found', active.sessionId);
    return false;
  }
  sendDirect(ws, snapshotEnvelope(active, snap));
  sendDirect(
    ws,
    envelope<ReplayDonePayload>('replay_done', { lastSeq: active.lastSeq }, active.sessionId),
  );
  return true;
}

// ─────────────────────────── handlers ───────────────────────────

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
  if (payload.thinking !== undefined && typeof payload.thinking !== 'boolean') {
    sendError(ws, 'bad_request');
    return;
  }
  if (payload.providerId !== undefined && typeof payload.providerId !== 'string') {
    sendError(ws, 'bad_request');
    return;
  }
  if (isInvalidEffort(payload.effort)) {
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

  // Thinking is on by default; approvalMode defaults to ask; effort defaults to
  // the provider default (null).
  const thinking = payload.thinking ?? true;
  const approvalMode: ApprovalMode = payload.approvalMode ?? 'ask';
  const effort: EffortLevel | null = payload.effort ?? null;

  let providerId = typeof payload.providerId === 'string' ? payload.providerId : null;
  let model = payload.model ?? null;
  // Drop a supplied providerId the user isn't allowed to use; falling through to
  // defaultSelectionForUser is preferable to persisting an unusable id.
  if (providerId && !(await resolveProviderForUser(deps.db, ws.data.userId, providerId))) {
    providerId = null;
    model = null;
  }
  if (!providerId) {
    const def = await defaultSelectionForUser(deps.db, ws.data.userId);
    if (def) {
      providerId = def.providerId;
      model = def.model;
    }
  }

  const sessionRowId = randomUUID();
  await deps.db.insert(schema.sessions).values({
    id: sessionRowId,
    userId: ws.data.userId,
    workDir,
    projectName,
    model,
    providerId,
    thinking,
    approvalMode,
    effort,
    status: 'active',
    title: null,
  });

  const active = deps.manager.register({
    sessionId: sessionRowId,
    userId: ws.data.userId,
    workDir,
    model,
    providerId,
    thinking,
    approvalMode,
    effort,
  });
  deps.manager.attachWS(active, ws);

  // The envelope's sessionId is the signal; the body is empty.
  broadcastEvent<SessionCreatedPayload>(active, 'session_created', {}, deps.manager);

  // Initial snapshot + replay_done to the requesting socket. No query yet — the
  // subprocess is spawned lazily on the first send_message.
  await sendSnapshot(ws, active);
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
  if (
    (payload.thinking !== undefined && typeof payload.thinking !== 'boolean') ||
    (payload.approvalMode !== undefined && !VALID_APPROVAL_MODE.has(payload.approvalMode)) ||
    isInvalidEffort(payload.effort)
  ) {
    sendError(ws, 'bad_request', sessionId);
    return;
  }

  const active = await deps.manager.getOrRestore(ws.data.userId, sessionId, (sid) =>
    deps.restore(sid, deps.manager, deps.db),
  );
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return;
  }
  if (active.turnInProgress) {
    sendError(ws, 'turn_in_progress', sessionId);
    return;
  }

  // Reject web-unsupported slash commands up front — no flag writes, no query spawn, no turn.
  if (tryHandleSlashCommand(active, payload.content)) return;

  // Apply composer flags that ride along with the send. Only fields that
  // actually flip are written + persisted; a resend with unchanged flags is a
  // no-op. When a query is already live, push the change into it directly so the
  // running subprocess honors it without a respawn.
  const flagChanges: {
    thinking?: boolean;
    approvalMode?: ApprovalMode;
    effort?: EffortLevel | null;
  } = {};
  if (payload.thinking !== undefined && payload.thinking !== active.thinking) {
    flagChanges.thinking = payload.thinking;
  }
  if (payload.approvalMode !== undefined && payload.approvalMode !== active.approvalMode) {
    flagChanges.approvalMode = payload.approvalMode;
  }
  if (payload.effort !== undefined && payload.effort !== active.effort) {
    flagChanges.effort = payload.effort;
  }
  if (
    flagChanges.thinking !== undefined ||
    flagChanges.approvalMode !== undefined ||
    flagChanges.effort !== undefined
  ) {
    if (flagChanges.thinking !== undefined) {
      active.thinking = flagChanges.thinking;
      // A live query honors thinking changes in place — null re-enables adaptive
      // thinking, 0 disables it — so the running subprocess applies it without a
      // respawn.
      await active.query?.setMaxThinkingTokens(flagChanges.thinking ? null : 0);
    }
    if (flagChanges.approvalMode !== undefined) {
      active.approvalMode = flagChanges.approvalMode;
      // A live query keeps its own permission mode; nudge it in place.
      await active.query?.setPermissionMode(mapMode(flagChanges.approvalMode));
    }
    if (flagChanges.effort !== undefined) {
      active.effort = flagChanges.effort;
      // A live query applies the effort flag in place; passing null resets it.
      await active.query?.applyFlagSettings({ effortLevel: flagChanges.effort });
    }
    await deps.db.update(schema.sessions).set(flagChanges).where(eq(schema.sessions.id, sessionId));
  }

  // Tracks whether a model and/or provider change was persisted, so we emit a
  // single session_updated to refresh other clients' session lists.
  let sessionPersisted = false;

  // Per-session model switch. Only when the composer rides along a model that
  // differs from the active one. A live query honors it in place; without one we
  // still record the choice so the lazy spawn picks it up.
  if (payload.model !== undefined && payload.model !== active.model) {
    active.model = payload.model;
    await active.query?.setModel(payload.model);
    await deps.db
      .update(schema.sessions)
      .set({ model: payload.model })
      .where(eq(schema.sessions.id, sessionId));
    sessionPersisted = true;
  }

  if (payload.providerId !== undefined && payload.providerId !== active.providerId) {
    // Authorize the requested provider BEFORE persisting it: a private built-in
    // (non-admin) or another user's personal provider must not be pinned.
    const resolved = await resolveProviderForUser(deps.db, ws.data.userId, payload.providerId);
    if (!resolved) {
      sendError(ws, 'provider_unset', sessionId, 'No provider selected');
      return;
    }
    active.providerId = payload.providerId;
    await deps.db
      .update(schema.sessions)
      .set({ providerId: payload.providerId })
      .where(eq(schema.sessions.id, sessionId));
    sessionPersisted = true;
    // The subprocess env is fixed at spawn — dispose any live query so ensureQuery
    // respawns with the new provider's credentials/endpoint.
    if (active.query) {
      try {
        await active.query.interrupt();
      } catch {
        /* may already be idle */
      }
      active.abortController?.abort();
      active.bridge?.close();
      active.query = null;
      active.abortController = null;
      active.bridge = null;
    }
  }

  if (sessionPersisted) {
    broadcastEvent<SessionUpdatedPayload>(active, 'session_updated', {}, deps.manager);
  }

  try {
    await ensureQuery(active);
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      sendError(ws, 'provider_unset', sessionId, 'No provider selected');
      return;
    }
    throw err;
  }

  active.turnInProgress = true;
  broadcastEvent<TurnBeginPayload>(
    active,
    'turn_begin',
    { userInput: payload.content, id: randomUUID() },
    deps.manager,
  );
  active.bridge?.push(payload.content);
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
  // Resolve the awaiting canUseTool promise; approval.ts maps it to a
  // PermissionResult.
  pending.resolve(payload.response);
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
  // Resolve the awaiting AskUserQuestion promise; approval.ts injects the
  // answers (+ annotations) into the tool's updatedInput.
  pending.resolve({
    requestId: payload.requestId,
    answers: payload.answers,
    ...(payload.annotations ? { annotations: payload.annotations } : {}),
  });
  active.pendingQuestions.delete(payload.requestId);
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
  // Best-effort: a race where the query already finalized is fine. The output
  // consumer emits turn_end on the resulting result message — we don't force
  // a broadcast here.
  try {
    await active.query?.interrupt();
  } catch (err) {
    logger.info(
      { sessionId, code: 'interrupt_noop', err: err instanceof Error ? err.message : String(err) },
      'interrupt_turn: query already idle or interrupt failed, treating as no-op',
    );
  }
  // Settle any canUseTool promise that was waiting on the interrupted turn.
  deps.manager.drainPendingRequests(active);
}

// ─────────────────────────── reconnect handlers ───────────────────────────

/**
 * Bring a session into memory (restoring its transcript via the lazy restoreFn),
 * attach the socket, and serve a fresh snapshot. The query stays lazy — the
 * first send_message spawns it with `resume`.
 */
async function attachAndSnapshot(ws: WS, sessionId: string): Promise<ActiveSession | null> {
  const active = await deps.manager.getOrRestore(ws.data.userId, sessionId, (sid) =>
    deps.restore(sid, deps.manager, deps.db),
  );
  if (!active) {
    sendError(ws, 'not_found', sessionId);
    return null;
  }
  deps.manager.attachWS(active, ws);
  if (!(await sendSnapshot(ws, active))) return null;
  return active;
}

async function handleSubscribe(ws: WS, payload: SubscribePayload | undefined): Promise<void> {
  if (!payload || typeof payload.sessionId !== 'string') {
    sendError(ws, 'bad_request');
    return;
  }
  await attachAndSnapshot(ws, payload.sessionId);
}

async function handleResumeSession(
  ws: WS,
  payload: ResumeSessionPayload | undefined,
): Promise<void> {
  if (!payload || typeof payload.sessionId !== 'string') {
    sendError(ws, 'bad_request');
    return;
  }
  await attachAndSnapshot(ws, payload.sessionId);
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
