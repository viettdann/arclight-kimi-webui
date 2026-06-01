import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { sessionTranscripts } from '../../db/schema/session-transcripts';
import { env } from '../../env';
import { logger } from '../../lib/logger';

const log = logger.child({ module: 'agent/transcript-store' });

/** `${CLAUDE_CONFIG_DIR}/projects` — where the `claude` binary writes JSONL. */
const PROJECTS = join(env.CLAUDE_CONFIG_DIR, 'projects');

/**
 * Max length of an encoded cwd before the binary switches to a hashed-slice
 * scheme. We keep `WORKSPACE_ROOT` short so we always stay in the 1:1 branch;
 * a startup self-test enforces this. Exported for that self-test to reference.
 */
export const MAX_ENCODED_LEN = 200;

/**
 * Encode a cwd the way the `claude` binary (2.1.158) does for its project
 * directory name: replace EVERY non-alphanumeric character with a single `-`,
 * 1:1 — no collapsing of consecutive dashes, length is preserved. We only
 * implement the `length <= 200` branch; the hashed-slice fallback never
 * triggers because `WORKSPACE_ROOT` is kept short (enforced at startup).
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Absolute path of the main transcript JSONL for a session. */
export function transcriptPath(cwd: string, sdkSessionId: string): string {
  return join(PROJECTS, encodeCwd(cwd), `${sdkSessionId}.jsonl`);
}

/** Absolute path of the subagent directory for a session. */
export function subagentDir(cwd: string, sdkSessionId: string): string {
  return join(PROJECTS, encodeCwd(cwd), sdkSessionId, 'subagents');
}

/**
 * Absolute path of the per-cwd project transcript dir the `claude` binary
 * writes into (`${CLAUDE_CONFIG_DIR}/projects/<enc(cwd)>`). Holds every
 * session's `<sdkSessionId>.jsonl` plus its `<sdkSessionId>/subagents/` subtree
 * for that cwd. Used by project/session deletion to remove on-disk transcripts.
 */
export function projectTranscriptDir(cwd: string): string {
  return join(PROJECTS, encodeCwd(cwd));
}

/**
 * Incrementally back up new JSONL bytes the binary appended since the last
 * call. Reads the DB `byteOffset`, slices the on-disk file from that offset to
 * EOF, and appends the delta via `content = content || $delta`. If the file
 * shrank below the recorded offset (truncate/fork), resets and re-backs up from
 * byte 0. Upserts the row when it doesn't exist yet. No-op if the file is
 * missing or holds no new bytes. Serialization is the caller's responsibility
 * (`ActiveSession.backupMutex`); each call is atomic on its own.
 */
export async function appendTranscript(
  sessionId: string,
  sdkSessionId: string,
  cwd: string,
): Promise<void> {
  const path = transcriptPath(cwd, sdkSessionId);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    log.debug({ sessionId, path }, 'transcript file not found — skipping append');
    return;
  }

  const size = file.size;
  if (size === 0) return;

  const existing = await db.query.sessionTranscripts.findFirst({
    where: eq(sessionTranscripts.sessionId, sessionId),
    columns: { byteOffset: true },
  });

  let offset = existing?.byteOffset ?? 0;

  // File shorter than the recorded offset means it was truncated or replaced
  // (e.g. fork/resume rewrote it). Re-read the whole file and overwrite.
  if (size < offset) {
    log.warn({ sessionId, size, offset }, 'transcript shorter than offset — full re-backup');
    offset = 0;
  }

  if (size === offset) return; // No new data.

  const delta = await file.slice(offset, size).text();
  const fullReset = offset === 0;

  await db
    .insert(sessionTranscripts)
    .values({
      sessionId,
      sdkSessionId,
      workspaceCwd: cwd,
      content: delta,
      byteOffset: size,
    })
    .onConflictDoUpdate({
      target: sessionTranscripts.sessionId,
      set: {
        // Reset (offset 0) overwrites; otherwise append the new bytes.
        content: fullReset ? delta : sql`${sessionTranscripts.content} || ${delta}`,
        byteOffset: size,
        sdkSessionId,
        workspaceCwd: cwd,
        updatedAt: new Date(),
      },
    });

  if (fullReset) {
    log.info({ sessionId, bytes: size }, 'transcript full backup');
  } else {
    log.debug({ sessionId, newBytes: size - offset }, 'transcript appended');
  }
}

/**
 * Back up subagent JSONL and metadata files into the `subagents` jsonb column,
 * keyed by basename. Reads every `*.jsonl` / `*.meta.json` under the session's
 * subagent dir and replaces the column with the collected map. No-op if the
 * directory is missing or holds no matching files.
 */
export async function backupSubagents(
  sessionId: string,
  sdkSessionId: string,
  cwd: string,
): Promise<void> {
  const dir = subagentDir(cwd, sdkSessionId);

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // Directory doesn't exist yet.
  }

  const files = names.filter((f) => f.endsWith('.jsonl') || f.endsWith('.meta.json'));
  if (files.length === 0) return;

  const data: Record<string, string> = {};
  for (const file of files) {
    data[file] = await Bun.file(join(dir, file)).text();
  }

  await db
    .update(sessionTranscripts)
    .set({ subagents: data, updatedAt: new Date() })
    .where(eq(sessionTranscripts.sessionId, sessionId));

  log.info({ sessionId, fileCount: files.length }, 'subagents backed up');
}

/**
 * Parse transcript JSONL and return the LATEST AI-generated title the `claude`
 * binary wrote into it — the `aiTitle` of the last `{"type":"ai-title",…}`
 * entry. The binary emits this line for free during a normal turn (no extra API
 * call on our side) and rewrites it last-wins, so the final occurrence is the
 * current title. Pure (no IO); returns null when no such entry exists.
 */
export function aiTitleFromJsonl(content: string): string | null {
  let title: string | null = null;
  for (const line of content.split('\n')) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj !== 'object' || obj === null) continue;
    const o = obj as { type?: unknown; aiTitle?: unknown };
    if (o.type !== 'ai-title' || typeof o.aiTitle !== 'string') continue;
    const trimmed = o.aiTitle.trim();
    if (trimmed) title = trimmed; // last-wins
  }
  return title;
}

/**
 * Read the session's AI title straight from the persisted transcript. Survives
 * restarts and `--watch` reloads, so it is the reliable source for titling a
 * session whose turn ran in an earlier runtime. Returns null if there is no
 * transcript yet or the binary has not written an `ai-title` entry.
 */
export async function aiTitleFromTranscript(sessionId: string): Promise<string | null> {
  const row = await db.query.sessionTranscripts.findFirst({
    where: eq(sessionTranscripts.sessionId, sessionId),
    columns: { content: true },
  });
  if (!row?.content) return null;
  return aiTitleFromJsonl(row.content);
}

/**
 * Restore the transcript (and any subagent files) from the DB back to the
 * filesystem so the binary can `resume` from them. Recreates the project dir,
 * writes the main JSONL, then writes each subagent entry into the subagent dir.
 *
 * After restore the DB `byteOffset` equals the restored content's byte length,
 * so the next `appendTranscript` reads only the NEW bytes the binary writes
 * past the restored tail. The DB content already records that exact tail, so no
 * extra write is needed to keep the offset consistent — we just ensure the
 * stored offset matches when it has drifted.
 */
export async function restoreTranscript(sessionId: string): Promise<void> {
  const row = await db.query.sessionTranscripts.findFirst({
    where: eq(sessionTranscripts.sessionId, sessionId),
  });
  if (!row?.sdkSessionId || !row.content) return;

  const dir = join(PROJECTS, encodeCwd(row.workspaceCwd));
  await mkdir(dir, { recursive: true });

  const path = join(dir, `${row.sdkSessionId}.jsonl`);
  await Bun.write(path, row.content);

  // Keep byteOffset == restored byte length so the next append reads only the
  // bytes the binary writes after the restored tail. `content` is text; its
  // byte length is the UTF-8 size, which is what the binary's file size is.
  const contentBytes = Buffer.byteLength(row.content, 'utf-8');
  if (row.byteOffset !== contentBytes) {
    await db
      .update(sessionTranscripts)
      .set({ byteOffset: contentBytes, updatedAt: new Date() })
      .where(eq(sessionTranscripts.sessionId, sessionId));
  }

  if (row.subagents && typeof row.subagents === 'object') {
    const dir2 = join(dir, row.sdkSessionId, 'subagents');
    await mkdir(dir2, { recursive: true });
    for (const [name, content] of Object.entries(row.subagents as Record<string, string>)) {
      // Guard against path escapes from a tampered jsonb map; only write a flat
      // basename into the subagent dir.
      await Bun.write(join(dir2, basename(name)), content);
    }
  }

  log.info(
    { sessionId, sdkSessionId: row.sdkSessionId, cwd: row.workspaceCwd },
    'transcript restored from DB',
  );
}
