import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createSession,
  KimiPaths,
  type Session,
  type SessionOptions,
} from '@moonshot-ai/kimi-agent-sdk';
import { eq, sql } from 'drizzle-orm';
import { type DB, db, schema } from '../db';

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
