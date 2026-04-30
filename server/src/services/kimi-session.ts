import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createSession,
  KimiPaths,
  type Session,
  type SessionOptions,
  type Turn,
} from '@moonshot-ai/kimi-agent-sdk';
import { eq, sql } from 'drizzle-orm';
import type {
  ApprovalRequestPayload,
  ErrorPayload,
  StatusUpdatePayload,
  TextDeltaPayload,
  ThinkingDeltaPayload,
  ToolCallPayload,
  ToolResultPayload,
} from 'shared/types';
import { type DB, db, schema } from '../db';
import { broadcastEvent } from '../lib/ws-broadcast';
import { createTranslatorState, translateStreamEvent } from '../ws/events';
import {
  insertApproval,
  insertAssistantMessage,
  insertToolCall,
  insertToolResult,
} from './messages';
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
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.thinking != null ? { thinking: args.thinking } : {}),
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

export interface BackupArgs {
  /** App-side session row id (uuid in `sessions` table). */
  sessionRowId: string;
  workDir: string;
  /** Kimi-assigned session id (used to locate the on-disk session dir). */
  kimiSessionId: string;
  /** Optional injected DB handle for tests. Defaults to the singleton. */
  db?: DB;
}

export interface BackupResult {
  appendedBytes: number;
  newOffset: number;
}

/**
 * After a turn completes: read new bytes from `wire.jsonl` since the last
 * recorded offset, append to `session_files.wireJsonl`, and refresh
 * `state.json` + `context.jsonl` snapshots. `wireByteOffset` advances atomically
 * with the append.
 *
 * Idempotent at the byte level: if the on-disk file is shorter than the
 * recorded offset (e.g. session reset), the entire wire is overwritten and
 * offset reset to current size.
 */
export async function backupAfterTurn(args: BackupArgs): Promise<BackupResult> {
  const dbh = args.db ?? db;
  const dir = KimiPaths.sessionDir(args.workDir, args.kimiSessionId);
  const wirePath = path.join(dir, 'wire.jsonl');
  const ctxPath = path.join(dir, 'context.jsonl');
  const statePath = path.join(dir, 'state.json');

  const [row] = await dbh
    .select({ offset: schema.sessionFiles.wireByteOffset })
    .from(schema.sessionFiles)
    .where(eq(schema.sessionFiles.sessionId, args.sessionRowId))
    .limit(1);
  const prevOffset = row?.offset ?? 0;

  const wireSize = await fileSize(wirePath);
  let appendBytes: Buffer;
  let newOffset: number;
  let resetWire = false;
  if (wireSize < prevOffset) {
    // File was truncated/reset under us — re-snapshot from byte 0.
    appendBytes = await readFile(wirePath);
    newOffset = wireSize;
    resetWire = true;
  } else if (wireSize > prevOffset) {
    appendBytes = await readRange(wirePath, prevOffset, wireSize - prevOffset);
    newOffset = wireSize;
  } else {
    appendBytes = Buffer.alloc(0);
    newOffset = prevOffset;
  }

  const [contextJsonl, stateJson] = await Promise.all([
    readFile(ctxPath, 'utf8').catch(() => ''),
    readFile(statePath, 'utf8').catch(() => ''),
  ]);

  const wireChunk = appendBytes.toString('utf8');
  const hash = workDirHash(args.workDir);

  await dbh
    .insert(schema.sessionFiles)
    .values({
      sessionId: args.sessionRowId,
      workDirHash: hash,
      wireJsonl: wireChunk,
      contextJsonl,
      stateJson,
      wireByteOffset: newOffset,
    })
    .onConflictDoUpdate({
      target: schema.sessionFiles.sessionId,
      set: {
        workDirHash: hash,
        wireJsonl: resetWire ? wireChunk : sql`${schema.sessionFiles.wireJsonl} || ${wireChunk}`,
        contextJsonl,
        stateJson,
        wireByteOffset: newOffset,
        updatedAt: sql`now()`,
      },
    });

  return { appendedBytes: appendBytes.byteLength, newOffset };
}

async function fileSize(p: string): Promise<number> {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

async function readRange(filePath: string, offset: number, length: number): Promise<Buffer> {
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

// ─────────────────────────── Turn pump ───────────────────────────

export interface PumpDeps {
  manager: KimiSessionManager;
  db?: DB;
}

/**
 * Drive a Turn end-to-end:
 *  - Iterate StreamEvents → translate → broadcast (with side-effects: DB
 *    inserts for tool_call / tool_result / approval, accumulate text/thinking).
 *  - On loop exit: flush assistant row, drain pending approvals (cancelled
 *    turn), clear `currentTurn`, broadcast `turn_end`, serialize `backupAfterTurn`
 *    via per-active mutex, refresh `sessions.totalTokens` + `lastActiveAt`,
 *    read `state.json#custom_title` and emit `title_update` if changed.
 *  - On thrown error: broadcast `error`, clear `currentTurn`, do NOT emit
 *    `turn_end`, do NOT crash session.
 *
 * Invariant #2: `currentTurn` is cleared before `turn_end` is broadcast so a
 * client sending `send_message` immediately after `turn_end` cannot race the
 * field.
 */
export async function pumpTurn(active: ActiveSession, turn: Turn, deps: PumpDeps): Promise<void> {
  const dbh = deps.db ?? db;
  const { manager } = deps;
  let textBuf = '';
  let thinkBuf = '';

  try {
    for await (const ev of turn) {
      const translated = translateStreamEvent(ev, active.translator);
      if (!translated) continue;

      switch (translated.type) {
        case 'text_delta': {
          textBuf += (translated.payload as TextDeltaPayload).text;
          break;
        }
        case 'thinking_delta': {
          thinkBuf += (translated.payload as ThinkingDeltaPayload).thinking;
          break;
        }
        case 'status_update': {
          active.lastStatusUpdate = translated.payload as StatusUpdatePayload;
          break;
        }
        case 'tool_call': {
          const p = translated.payload as ToolCallPayload;
          active.toolNameByCallId.set(p.id, p.name);
          await insertToolCall({
            sessionId: active.sessionId,
            toolName: p.name,
            toolInput: p.arguments,
            db: dbh,
          });
          break;
        }
        case 'tool_result': {
          const p = translated.payload as ToolResultPayload;
          const toolName = active.toolNameByCallId.get(p.toolCallId) ?? 'unknown';
          await insertToolResult({
            sessionId: active.sessionId,
            toolName,
            content: JSON.stringify(p.output ?? null),
            isError: p.isError,
            db: dbh,
          });
          break;
        }
        case 'approval_request': {
          const p = translated.payload as ApprovalRequestPayload;
          await insertApproval({
            sessionId: active.sessionId,
            requestId: p.requestId,
            action: p.action,
            description: p.description,
            db: dbh,
          });
          active.pendingApprovals.set(p.requestId, {
            requestId: p.requestId,
            payload: p,
            turn,
          });
          break;
        }
      }

      broadcastEvent(active, translated.type, translated.payload, manager);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    active.currentTurn = null;
    const errorPayload: ErrorPayload = {
      code: 'turn_error',
      message,
      retryable: false,
    };
    broadcastEvent(active, 'error', errorPayload, manager);
    return;
  }

  const result = await turn.result;

  if (textBuf.length > 0 || thinkBuf.length > 0) {
    await insertAssistantMessage({
      sessionId: active.sessionId,
      content: textBuf,
      thinking: thinkBuf.length > 0 ? thinkBuf : null,
      db: dbh,
    });
  }

  if (active.pendingApprovals.size > 0) {
    for (const pending of active.pendingApprovals.values()) {
      const toolName = active.toolNameByCallId.get(pending.payload.id) ?? 'unknown';
      await insertToolResult({
        sessionId: active.sessionId,
        toolName,
        content: '<approval not answered>',
        isError: true,
        db: dbh,
      });
    }
    active.pendingApprovals.clear();
  }

  // Invariant #2: clear before broadcast.
  active.currentTurn = null;

  broadcastEvent(active, 'turn_end', { status: result.status, steps: result.steps ?? 0 }, manager);

  // Invariant #1: serialize backups per active.
  const next = active.backupMutex.then(() =>
    backupAfterTurn({
      sessionRowId: active.sessionId,
      workDir: active.workDir,
      kimiSessionId: active.kimiSessionId,
      db: dbh,
    }).then(() => undefined),
  );
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
 *
 * Throws `Error('not_found')` for missing rows, `status='closed'`, or absent
 * `kimiSessionId`. Caller (`SessionManager.getOrRestore`) catches and surfaces
 * uniform `not_found` to clients.
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

  const kimi = factory({
    workDir: sessRow.workDir,
    sessionId: sessRow.kimiSessionId,
    ...(sessRow.model ? { model: sessRow.model } : {}),
    thinking: sessRow.thinking,
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
