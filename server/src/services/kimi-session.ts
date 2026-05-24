import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createSession,
  KimiPaths,
  type Session,
  type SessionOptions,
  type StreamEvent,
  type Turn,
} from '@moonshot-ai/kimi-agent-sdk';
import { eq, sql } from 'drizzle-orm';
import type { ApprovalRequestPayload, ErrorPayload, QuestionRequestPayload } from 'shared/types';
import { type DB, db, schema } from '../db';
import { broadcastEvent } from '../lib/ws-broadcast';
import { logger } from '../lib/logger';
import { SERVICE_NAME, SERVICE_VERSION } from '../version';
import { createTranslatorState, translateStreamEvent } from '../ws/events';
import { loadEnvForInjection } from './kimi-config/env-injection';
import { clearPendingPrompt } from './pending-prompts';
import type { ActiveSession, KimiSessionManager } from './session-manager';
import { extractTitle, stateJsonPathFor } from './title';

// Workspace-rooted Kimi sessions live at:
//   ~/.kimi/sessions/{md5(workDirAbs)}/{sessionId}/{state.json,wire.jsonl,context.jsonl}
// `KimiPaths.sessionDir(workDir, sessionId)` returns that path; the SDK reads
// from it on `createSession({ sessionId })`. We mirror the three files into
// session_files after every turn, and rehydrate them before resume.

export function workDirHash(workDirAbs: string): string {
  return createHash('md5').update(workDirAbs).digest('hex');
}

export interface CreateKimiArgs {
  workDir: string;
  model?: string;
  thinking?: boolean;
  /**
   * Forwarded to SDK `SessionOptions.yoloMode`. When true, the agent skips
   * approval prompts for tool calls — caller is responsible for the trust
   * decision and persistence to the `sessions` row.
   */
  yoloMode?: boolean;
  /** Restore an existing session by id (caller must have already restored files). */
  sessionId?: string;
  /** Forwarded as SDK env (e.g. HOME for non-root processes). */
  env?: Record<string, string>;
  /** Override KIMI_SHARE_DIR to put `~/.kimi` somewhere else. */
  shareDir?: string;
}

export function createKimi(args: CreateKimiArgs): Session {
  const opts: SessionOptions = {
    workDir: args.workDir,
    clientInfo: { name: SERVICE_NAME, version: SERVICE_VERSION },
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.thinking != null ? { thinking: args.thinking } : {}),
    ...(args.yoloMode != null ? { yoloMode: args.yoloMode } : {}),
    ...(args.env ? { env: args.env } : {}),
    ...(args.shareDir ? { shareDir: args.shareDir } : {}),
  };
  return createSession(opts);
}

/** True iff the on-disk Kimi session directory still exists. */
export async function kimiSessionDirExists(workDir: string, sessionId: string): Promise<boolean> {
  try {
    const dir = KimiPaths.sessionDir(workDir, sessionId);
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lazy restore: write `wire.jsonl`, `context.jsonl`, `state.json` from the DB
 * backup back onto disk, so the next `createSession({ sessionId })` reattaches
 * the existing transcript.
 *
 * Caller must invoke this before `createKimi({ sessionId })` for a session
 * that's not currently in memory.
 */
export async function restoreKimiFiles(
  workDir: string,
  sessionId: string,
  files: { wireJsonl: string; contextJsonl: string; stateJson: string },
): Promise<void> {
  const dir = KimiPaths.sessionDir(workDir, sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(path.join(dir, 'wire.jsonl'), files.wireJsonl, { mode: 0o600 }),
    writeFile(path.join(dir, 'context.jsonl'), files.contextJsonl, { mode: 0o600 }),
    writeFile(path.join(dir, 'state.json'), files.stateJson, { mode: 0o600 }),
  ]);
}

export async function fileSize(p: string): Promise<number> {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

export async function readRange(filePath: string, offset: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, offset);
    return buf;
  } finally {
    await fh.close();
  }
}

export async function appendWireDelta(
  active: ActiveSession,
  force = false,
  dbConn?: DB,
): Promise<void> {
  const dbh = dbConn ?? db;
  const dir = KimiPaths.sessionDir(active.workDir, active.kimiSessionId);
  const wirePath = path.join(dir, 'wire.jsonl');

  const [row] = await dbh
    .select({ offset: schema.sessionFiles.wireByteOffset })
    .from(schema.sessionFiles)
    .where(eq(schema.sessionFiles.sessionId, active.sessionId))
    .limit(1);
  const prevOffset = row?.offset ?? 0;

  const wireSize = await fileSize(wirePath);
  if (wireSize === prevOffset) return;

  const delta = wireSize - prevOffset;
  if (delta < 4096 && !force) return;

  let appendBytes: Buffer;
  let newOffset: number;
  let resetWire = false;

  if (wireSize < prevOffset) {
    appendBytes = await readFile(wirePath);
    newOffset = wireSize;
    resetWire = true;
  } else {
    appendBytes = await readRange(wirePath, prevOffset, delta);
    newOffset = wireSize;
  }

  const wireChunk = appendBytes.toString('utf8');
  const hash = workDirHash(active.workDir);

  await dbh
    .insert(schema.sessionFiles)
    .values({
      sessionId: active.sessionId,
      workDirHash: hash,
      wireJsonl: wireChunk,
      contextJsonl: '',
      stateJson: '',
      wireByteOffset: newOffset,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.sessionFiles.sessionId,
      set: {
        workDirHash: hash,
        wireJsonl: resetWire ? wireChunk : sql`${schema.sessionFiles.wireJsonl} || ${wireChunk}`,
        wireByteOffset: newOffset,
        updatedAt: sql`now()`,
      },
    });
}

export async function maybeAppendWireDelta(active: ActiveSession, dbConn?: DB): Promise<void> {
  await appendWireDelta(active, false, dbConn);
}

export async function flushContextAndState(active: ActiveSession, dbConn?: DB): Promise<void> {
  const dbh = dbConn ?? db;
  const dir = KimiPaths.sessionDir(active.workDir, active.kimiSessionId);
  const ctxPath = path.join(dir, 'context.jsonl');
  const statePath = path.join(dir, 'state.json');

  const [contextJsonl, stateJson] = await Promise.all([
    readFile(ctxPath, 'utf8').catch(() => ''),
    readFile(statePath, 'utf8').catch(() => ''),
  ]);

  const hash = workDirHash(active.workDir);

  await dbh
    .insert(schema.sessionFiles)
    .values({
      sessionId: active.sessionId,
      workDirHash: hash,
      wireJsonl: '',
      contextJsonl,
      stateJson,
      wireByteOffset: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.sessionFiles.sessionId,
      set: {
        workDirHash: hash,
        contextJsonl,
        stateJson,
        updatedAt: sql`now()`,
      },
    });
}

export function updateLiveOverlay(active: ActiveSession, ev: StreamEvent): void {
  switch (ev.type) {
    case 'TurnBegin': {
      active.liveTurnIdx = (active.liveTurnIdx ?? -1) + 1;
      active.liveStepIdx = 0;
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      active.partialToolCallArgs.clear();
      break;
    }
    case 'StepBegin': {
      active.liveStepIdx = (ev.payload as any).n;
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      break;
    }
    case 'ContentPart': {
      const part = ev.payload as any;
      if (part.type === 'text') {
        active.liveTextDelta += part.text;
      } else if (part.type === 'think') {
        active.liveThinkingDelta += part.think;
      }
      break;
    }
    case 'ToolCallPart': {
      const p = ev.payload as any;
      if (active.translator.lastToolCallId) {
        const id = active.translator.lastToolCallId;
        const prev = active.partialToolCallArgs.get(id) ?? '';
        active.partialToolCallArgs.set(id, prev + (p.arguments_part ?? ''));
      }
      break;
    }
    case 'ToolCall': {
      const p = ev.payload as any;
      active.partialToolCallArgs.delete(p.id);
      break;
    }
    case 'StepInterrupted': {
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      break;
    }
    case 'TurnEnd': {
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      active.partialToolCallArgs.clear();
      active.liveTurnIdx = null;
      active.liveStepIdx = null;
      break;
    }
  }
}

// ─────────────────────────── Turn pump ───────────────────────────

export interface PumpDeps {
  manager: KimiSessionManager;
  db?: DB;
}

/**
 * Drive a Turn end-to-end:
 *  - Iterate StreamEvents → translate → broadcast.
 *  - On loop exit: clear `currentTurn`, broadcast `turn_end`, serialize flushes,
 *    refresh `sessions.totalTokens` + `lastActiveAt`,
 *    read `state.json#custom_title` and emit `title_update` if changed.
 */
export async function pumpTurn(active: ActiveSession, turn: Turn, deps: PumpDeps): Promise<void> {
  const dbh = deps.db ?? db;
  const { manager } = deps;

  try {
    for await (const ev of turn) {
      const translated = translateStreamEvent(ev, active.translator);
      if (translated) {
        if (translated.type === 'turn_begin') {
          await clearPendingPrompt(active.sessionId, dbh);
        } else if (translated.type === 'approval_request') {
          const p = translated.payload as ApprovalRequestPayload;
          active.pendingApprovals.set(p.requestId, {
            requestId: p.requestId,
            payload: p,
            turn,
          });
        } else if (translated.type === 'question_request') {
          const p = translated.payload as QuestionRequestPayload;
          active.pendingQuestions.set(p.requestId, {
            rpcRequestId: p.requestId,
            questionRequestId: p.requestId,
            payload: p,
            turn,
          });
        }
        broadcastEvent(active, translated.type, translated.payload, manager);
      }
      updateLiveOverlay(active, ev);
      await maybeAppendWireDelta(active, dbh);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    active.currentTurn = null;
    active.pendingApprovals.clear();
    active.pendingQuestions.clear();
    active.translator = createTranslatorState();
    active.toolNameByCallId.clear();
    active.lastStatusUpdate = null;
    active.partialToolCallArgs.clear();
    active.liveTextDelta = '';
    active.liveThinkingDelta = '';
    active.liveTurnIdx = null;
    active.liveStepIdx = null;

    try {
      await appendWireDelta(active, true, dbh);
      await flushContextAndState(active, dbh);
    } catch (dbErr) {
      logger.error({ err: dbErr, sessionId: active.sessionId }, 'pumpTurn catch path: backup fail');
    }

    await clearPendingPrompt(active.sessionId, dbh);
    const errorPayload: ErrorPayload = {
      code: 'turn_error',
      message,
      retryable: false,
    };
    broadcastEvent(active, 'error', errorPayload, manager);
    return;
  }

  const result = await turn.result;

  active.pendingApprovals.clear();
  active.pendingQuestions.clear();

  // Invariant #2: clear before broadcast.
  active.currentTurn = null;

  broadcastEvent(active, 'turn_end', { status: result.status, steps: result.steps ?? 0 }, manager);

  // Invariant #1: serialize backups per active.
  const next = active.backupMutex.then(async () => {
    await appendWireDelta(active, true, dbh);
    await flushContextAndState(active, dbh);
  });
  active.backupMutex = next.catch(() => undefined);
  await next;

  const tokens = active.lastStatusUpdate?.tokenUsage;
  await dbh
    .update(schema.sessions)
    .set({
      ...(tokens != null ? { totalTokens: tokens } : {}),
      lastActiveAt: sql`now()`,
    })
    .where(eq(schema.sessions.id, active.sessionId));

  const newTitle = await extractTitle(stateJsonPathFor(active.workDir, active.kimiSessionId));
  if (newTitle !== null) {
    const [row] = await dbh
      .select({ title: schema.sessions.title })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, active.sessionId))
      .limit(1);
    if (row && row.title !== newTitle) {
      await dbh
        .update(schema.sessions)
        .set({ title: newTitle })
        .where(eq(schema.sessions.id, active.sessionId));
      broadcastEvent(active, 'title_update', { title: newTitle }, manager);
    }
  }

  active.translator = createTranslatorState();
  active.toolNameByCallId.clear();
  active.lastStatusUpdate = null;
}

// ─────────────────────────── Restore from backup ───────────────────────────

export interface RestoreFromBackupArgs {
  sessionId: string;
  manager: KimiSessionManager;
  db?: DB;
  shareDir?: string;
  /** Override SDK factory for tests. Defaults to `createKimi`. */
  createKimiFn?: (args: CreateKimiArgs) => Session;
}

/**
 * Lazy resume of a not-in-memory session. Reads `sessions` + `session_files`
 * from DB, re-materializes `~/.kimi/sessions/...` files, calls
 * `createSession({sessionId})`, and registers the resulting `ActiveSession`.
 */
export async function restoreFromBackup(args: RestoreFromBackupArgs): Promise<ActiveSession> {
  const dbh = args.db ?? db;
  const factory = args.createKimiFn ?? createKimi;

  const [sessRow] = await dbh
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, args.sessionId))
    .limit(1);
  if (!sessRow || sessRow.status === 'closed' || sessRow.kimiSessionId === null) {
    throw new Error('not_found');
  }

  const [filesRow] = await dbh
    .select()
    .from(schema.sessionFiles)
    .where(eq(schema.sessionFiles.sessionId, args.sessionId))
    .limit(1);

  const hasBackup =
    filesRow != null &&
    (filesRow.wireJsonl.length > 0 ||
      filesRow.contextJsonl.length > 0 ||
      filesRow.stateJson.length > 0);

  if (hasBackup && filesRow != null) {
    await restoreKimiFiles(sessRow.workDir, sessRow.kimiSessionId, {
      wireJsonl: filesRow.wireJsonl,
      contextJsonl: filesRow.contextJsonl,
      stateJson: filesRow.stateJson,
    });
  }

  const envVars = await loadEnvForInjection(dbh);

  const kimi = factory({
    workDir: sessRow.workDir,
    sessionId: sessRow.kimiSessionId,
    ...(sessRow.model ? { model: sessRow.model } : {}),
    thinking: sessRow.thinking,
    yoloMode: sessRow.yoloMode,
    env: envVars,
    ...(args.shareDir ? { shareDir: args.shareDir } : {}),
  });

  return args.manager.register({
    sessionId: sessRow.id,
    userId: sessRow.userId,
    workDir: sessRow.workDir,
    kimiSessionId: sessRow.kimiSessionId,
    kimiSession: kimi,
  });
}
