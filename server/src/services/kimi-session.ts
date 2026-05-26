import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createSession,
  type Session,
  type SessionOptions,
  type StreamEvent,
  type Turn,
} from '@moonshot-ai/kimi-agent-sdk';
import { and, eq, sql } from 'drizzle-orm';
import type { ApprovalRequestPayload, ErrorPayload, QuestionRequestPayload } from 'shared/types';
import { type DB, db, schema } from '../db';
import { env as defaultEnv } from '../env';
import { logger } from '../lib/logger';
import { broadcastEvent } from '../lib/ws-broadcast';
import { SERVICE_NAME, SERVICE_VERSION } from '../version';
import { createTranslatorState, translateStreamEvent } from '../ws/events';
import { loadEnvForInjection } from './kimi-config/env-injection';
import { kimiPaths } from './kimi-config/paths';
import { resolveShareDir } from './kimi-config/share-dir';
import { ensureKimiMetadata } from './kimi-config/share-metadata';
import { clearPendingPrompt } from './pending-prompts';
import { sanitizeStateJson, stripSystemPromptHead } from './restore-transforms';
import type { ActiveSession, KimiSessionManager } from './session-manager';
import { extractTitle, stateJsonPathFor } from './title';
import { maybeGenerateTitleBackground } from './title-generate';
import { countTurnBeginsInWireBytes } from './wire-events';
import { ensureWorkDir, resolveWorkDir } from './work-dir';

// Workspace-rooted Kimi sessions live at:
//   <KIMI_SHARE_DIR>/sessions/{md5(workDirAbs)}/{sessionId}/{state.json,wire.jsonl,context.jsonl}
// `kimiPaths().sessionDir(workDir, sessionId)` returns that path; the SDK reads
// from it on `createSession({ sessionId })`. We mirror the three files into
// session_files after every turn, and rehydrate them before resume.

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
  /** Absolute KIMI_SHARE_DIR. Defaults to `resolveShareDir()`. */
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
    shareDir: args.shareDir ?? resolveShareDir(),
  };
  return createSession(opts);
}

/** True iff the on-disk Kimi session directory still exists. */
export async function kimiSessionDirExists(workDir: string, sessionId: string): Promise<boolean> {
  try {
    const dir = kimiPaths().sessionDir(workDir, sessionId);
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
  opts?: { transform?: boolean },
): Promise<void> {
  const dir = kimiPaths().sessionDir(workDir, sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const transform = opts?.transform === true;
  const contextJsonl = transform ? stripSystemPromptHead(files.contextJsonl) : files.contextJsonl;
  const stateJson = transform ? sanitizeStateJson(files.stateJson) : files.stateJson;
  await Promise.all([
    writeFile(path.join(dir, 'wire.jsonl'), files.wireJsonl, { mode: 0o600 }),
    writeFile(path.join(dir, 'context.jsonl'), contextJsonl, { mode: 0o600 }),
    writeFile(path.join(dir, 'state.json'), stateJson, { mode: 0o600 }),
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
  const dir = kimiPaths().sessionDir(active.workDir, active.kimiSessionId);
  const wirePath = path.join(dir, 'wire.jsonl');

  const [row] = await dbh
    .select({ offset: schema.kimiSessionFiles.wireByteOffset })
    .from(schema.kimiSessionFiles)
    .where(eq(schema.kimiSessionFiles.sessionId, active.sessionId))
    .limit(1);
  const prevOffset = row?.offset ?? 0;

  const wireSize = await fileSize(wirePath);
  if (wireSize === prevOffset) return;

  if (wireSize < prevOffset) {
    logger.warn(
      { sessionId: active.sessionId, wireSize, prevOffset },
      'wire shrunk; skipping append',
    );
    return;
  }

  const delta = wireSize - prevOffset;
  if (delta < 4096 && !force) return;

  const appendBytes = await readRange(wirePath, prevOffset, delta);
  const newOffset = wireSize;

  const wireChunk = appendBytes.toString('utf8');

  await dbh
    .insert(schema.kimiSessionFiles)
    .values({
      sessionId: active.sessionId,
      wireJsonl: wireChunk,
      contextJsonl: '',
      stateJson: '',
      wireByteOffset: newOffset,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.kimiSessionFiles.sessionId,
      set: {
        wireJsonl: sql`${schema.kimiSessionFiles.wireJsonl} || ${wireChunk}`,
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
  const dir = kimiPaths().sessionDir(active.workDir, active.kimiSessionId);
  const ctxPath = path.join(dir, 'context.jsonl');
  const statePath = path.join(dir, 'state.json');

  const [contextJsonl, stateJson] = await Promise.all([
    readFile(ctxPath, 'utf8').catch(() => ''),
    readFile(statePath, 'utf8').catch(() => ''),
  ]);

  await dbh
    .insert(schema.kimiSessionFiles)
    .values({
      sessionId: active.sessionId,
      wireJsonl: '',
      contextJsonl,
      stateJson,
      wireByteOffset: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.kimiSessionFiles.sessionId,
      set: {
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
      active.liveThinkPartIdx = 0;
      active.liveTextPartIdx = 0;
      active.partialToolCallArgs.clear();
      break;
    }
    case 'StepBegin': {
      active.liveStepIdx = (ev.payload as any).n;
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      active.liveThinkPartIdx = 0;
      active.liveTextPartIdx = 0;
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
      // A `ToolCall` ends any in-flight think/text segment within this step.
      // Bump partIdx so the *next* think/text segment gets a fresh id and
      // doesn't merge with the just-finalized block on the client.
      if (active.liveThinkingDelta) {
        active.liveThinkingDelta = '';
        active.liveThinkPartIdx++;
      }
      if (active.liveTextDelta) {
        active.liveTextDelta = '';
        active.liveTextPartIdx++;
      }
      const p = ev.payload as any;
      active.partialToolCallArgs.delete(p.id);
      break;
    }
    case 'ToolResult': {
      // Drop any partial-args overlay for the finished tool_call. Without this
      // a tool that streamed args and then completed mid-turn would still get
      // its block stamped `isStreaming=true` in resume snapshots, leaving the
      // row spinning even though tool_result is already present.
      const p = ev.payload as any;
      active.partialToolCallArgs.delete(p.tool_call_id);
      break;
    }
    case 'StepInterrupted': {
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      break;
    }
    case 'TurnEnd': {
      // Clear in-flight deltas but PRESERVE liveTurnIdx / liveStepIdx so the
      // next `TurnBegin` increments from the right value. Resetting to null
      // here caused the cross-turn collision bug: after `(null ?? -1) + 1`
      // the next turn would land back on turnIdx=0 and stream into the
      // previous turn's block.
      active.liveTextDelta = '';
      active.liveThinkingDelta = '';
      active.partialToolCallArgs.clear();
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
      // Pass the current think/text partIdx so `text_delta` and
      // `thinking_delta` payloads carry the partIdx the client needs to
      // disambiguate multiple segments within a (turn, step).
      const translated = translateStreamEvent(ev, active.translator, {
        thinkPartIdx: active.liveThinkPartIdx,
        textPartIdx: active.liveTextPartIdx,
      });
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
    // Keep liveTurnIdx so the next TurnBegin increments from the right value.
    // Reset partIdx so a fresh attempt starts at 0 within the same turn slot.
    active.liveStepIdx = null;
    active.liveThinkPartIdx = 0;
    active.liveTextPartIdx = 0;

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

  // Post-turn finalisation is best-effort. If the row was deleted between
  // pump start and pump finish (e.g. user clicked delete while the turn was
  // wrapping up), every DB write below races with the cascade-delete and may
  // surface as an FK violation. None of these errors should crash the pump
  // promise — they're cleanup, not contract.
  try {
    // Invariant #1: serialize backups per active.
    const next = active.backupMutex.then(async () => {
      await appendWireDelta(active, true, dbh);
      await flushContextAndState(active, dbh);
    });
    active.backupMutex = next.catch(() => undefined);
    await next;
  } catch (err) {
    logger.warn(
      { err, sessionId: active.sessionId },
      'pumpTurn: post-turn backup failed (session likely deleted)',
    );
  }

  try {
    const tokens = active.lastStatusUpdate?.tokenUsage;
    await dbh
      .update(schema.kimiSessions)
      .set({
        ...(tokens != null ? { totalTokens: tokens } : {}),
        lastActiveAt: sql`now()`,
      })
      .where(eq(schema.kimiSessions.id, active.sessionId));
  } catch (err) {
    logger.warn(
      { err, sessionId: active.sessionId },
      'pumpTurn: lastActive/tokens update failed',
    );
  }

  // Read state.json once for both the custom_title sync (below) and the
  // background title generator (further down). Avoids a duplicate disk read
  // per turn.
  let extracted: Awaited<ReturnType<typeof extractTitle>> = null;
  try {
    extracted = await extractTitle(stateJsonPathFor(active.workDir, active.kimiSessionId));
    // Only adopt state.json's title when the Kimi runtime flagged it as AI-
    // generated. By default the SDK seeds `custom_title` with the first user
    // prompt and leaves `title_generated=false`; treating that as authoritative
    // would clobber DB and block `maybeGenerateTitleBackground` forever.
    if (extracted !== null && extracted.generated) {
      const [row] = await dbh
        .select({ title: schema.kimiSessions.title })
        .from(schema.kimiSessions)
        .where(eq(schema.kimiSessions.id, active.sessionId))
        .limit(1);
      if (row && row.title !== extracted.title) {
        await dbh
          .update(schema.kimiSessions)
          .set({ title: extracted.title })
          .where(eq(schema.kimiSessions.id, active.sessionId));
        broadcastEvent(active, 'title_update', { title: extracted.title }, manager);
      }
    }
  } catch (err) {
    logger.warn({ err, sessionId: active.sessionId }, 'pumpTurn: title sync failed');
  }

  // Fire-and-forget AI title generation for sessions still untitled. Guarded
  // by an in-memory inflight set and a DB skip-if-set check inside the
  // function, so safe to invoke after every turn — it short-circuits cheaply
  // for already-titled sessions. Reuse the state.json payload we just read.
  void maybeGenerateTitleBackground(active, manager, dbh, { prefetchedState: extracted });

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
  env?: { WORKSPACE_ROOT: string };
  /** Override SDK factory for tests. Defaults to `createKimi`. */
  createKimiFn?: (args: CreateKimiArgs) => Session;
}

/**
 * Lazy resume of a not-in-memory session. Reads `sessions` joined with `user`
 * for the owner email, computes the local absolute workDir from
 * `(WORKSPACE_ROOT, slug(email), projectName)`, materialises the on-disk
 * `.kimi/sessions/...` files from `session_files`, updates the cached
 * `sessions.workDir` if the local path differs (cross-machine adoption), and
 * registers the resulting `ActiveSession`.
 */
export async function restoreFromBackup(args: RestoreFromBackupArgs): Promise<ActiveSession> {
  const dbh = args.db ?? db;
  const factory = args.createKimiFn ?? createKimi;
  const envSrc = args.env ?? defaultEnv;

  const [joined] = await dbh
    .select({
      session: schema.kimiSessions,
      userEmail: schema.user.email,
    })
    .from(schema.kimiSessions)
    .innerJoin(schema.user, eq(schema.user.id, schema.kimiSessions.userId))
    .where(eq(schema.kimiSessions.id, args.sessionId))
    .limit(1);
  if (!joined || joined.session.status === 'closed') {
    throw new Error('not_found');
  }
  const sessRow = joined.session;
  const kimiSessionId = sessRow.kimiSessionId;
  if (kimiSessionId === null) {
    throw new Error('not_found');
  }

  const localWorkDir = resolveWorkDir({
    userEmail: joined.userEmail,
    projectName: sessRow.projectName,
    env: envSrc,
  });
  const shareDir = args.shareDir ?? resolveShareDir();

  // ensureWorkDir, ensureKimiMetadata, session_files SELECT, and
  // loadEnvForInjection are independent after the joined SELECT — run them
  // concurrently to shave round-trips off the lazy-resume hot path.
  const [, , filesRows, envVars] = await Promise.all([
    ensureWorkDir(localWorkDir),
    ensureKimiMetadata(shareDir, localWorkDir),
    dbh
      .select()
      .from(schema.kimiSessionFiles)
      .where(eq(schema.kimiSessionFiles.sessionId, args.sessionId))
      .limit(1),
    loadEnvForInjection(dbh),
  ]);
  const filesRow = filesRows[0];

  // Cascade-rewrite every sibling row under `(userId, projectName)` so all
  // sessions in this project flip to local atomically. Sibling rows already
  // at `localWorkDir` are no-ops at the row level; the statement still
  // touches them, which is acceptable.
  const cascadeWorkDir = () =>
    dbh
      .update(schema.kimiSessions)
      .set({ workDir: localWorkDir })
      .where(
        and(
          eq(schema.kimiSessions.userId, sessRow.userId),
          eq(schema.kimiSessions.projectName, sessRow.projectName),
        ),
      );

  if (filesRow != null) {
    await restoreKimiFiles(
      localWorkDir,
      kimiSessionId,
      {
        wireJsonl: filesRow.wireJsonl,
        contextJsonl: filesRow.contextJsonl,
        stateJson: filesRow.stateJson,
      },
      { transform: true },
    );
    // Wire blob just replaced disk; reset the byte-offset cursor to the
    // restored blob's length so the next `appendWireDelta` computes its
    // delta from the right baseline. Run alongside the cascade — different
    // tables, no ordering dependency.
    const newOffset = Buffer.byteLength(filesRow.wireJsonl, 'utf8');
    await Promise.all([
      dbh
        .update(schema.kimiSessionFiles)
        .set({ wireByteOffset: newOffset })
        .where(eq(schema.kimiSessionFiles.sessionId, args.sessionId)),
      cascadeWorkDir(),
    ]);
  } else {
    logger.error(
      { sessionId: args.sessionId, kimiSessionId, workDir: localWorkDir },
      'restoreFromBackup: session_files row missing; skipping materialise',
    );
    await cascadeWorkDir();
  }

  const kimi = factory({
    workDir: localWorkDir,
    sessionId: kimiSessionId,
    ...(sessRow.model ? { model: sessRow.model } : {}),
    thinking: sessRow.thinking,
    yoloMode: sessRow.yoloMode,
    env: envVars,
    shareDir,
  });

  // Count completed turns from the restored wire log so the next TurnBegin
  // increments liveTurnIdx from the right slot — otherwise it'd start back at
  // 0 and collide with completed turns' block ids.
  const turnCount = filesRow?.wireJsonl ? countTurnBeginsInWireBytes(filesRow.wireJsonl) : 0;
  const initialLiveTurnIdx = turnCount > 0 ? turnCount - 1 : null;

  return args.manager.register({
    sessionId: sessRow.id,
    userId: sessRow.userId,
    workDir: localWorkDir,
    kimiSessionId,
    kimiSession: kimi,
    initialLiveTurnIdx,
  });
}
