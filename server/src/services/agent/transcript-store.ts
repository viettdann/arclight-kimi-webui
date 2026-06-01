import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { sessionTranscripts } from '../../db/schema/session-transcripts';
import { logger } from '../../lib/logger';
import { agentConfigDirFor } from './agent-paths';

const log = logger.child({ module: 'agent/transcript-store' });

/**
 * `<per-user CLAUDE_CONFIG_DIR>/projects` for a given cwd — where the `claude`
 * binary writes JSONL. The config dir is per-user (derived from the cwd's user
 * slug via `agent-paths`), so the subprocess and these path helpers always agree
 * on the same location for the same session (invariant: write-here == read-here).
 */
function projectsRoot(cwd: string): string {
  return join(agentConfigDirFor(cwd), 'projects');
}

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
  return join(projectsRoot(cwd), encodeCwd(cwd), `${sdkSessionId}.jsonl`);
}

/** Absolute path of the subagent directory for a session. */
export function subagentDir(cwd: string, sdkSessionId: string): string {
  return join(projectsRoot(cwd), encodeCwd(cwd), sdkSessionId, 'subagents');
}

/**
 * Absolute path of the per-cwd project transcript dir the `claude` binary
 * writes into (`<per-user CLAUDE_CONFIG_DIR>/projects/<enc(cwd)>`). Holds every
 * session's `<sdkSessionId>.jsonl` plus its `<sdkSessionId>/subagents/` subtree
 * for that cwd. Used by project/session deletion to remove on-disk transcripts.
 */
export function projectTranscriptDir(cwd: string): string {
  return join(projectsRoot(cwd), encodeCwd(cwd));
}

/**
 * Count the content-block lines an assistant `message.id` has on disk. Claude
 * Code splits each content block onto its OWN JSONL line, all sharing the same
 * `message.id`, so the block count for an id is the sum of `message.content.length`
 * over every well-formed `type:'assistant'` line whose `message.id` matches.
 *
 * Parse-match (not substring): a half-written tail line is invalid JSON and is
 * skipped, so it never advances the count. That is exactly the barrier we want —
 * only a complete line counts, so the committed content is always valid JSONL.
 */
function countAssistantBlocks(content: string, messageId: string): number {
  let count = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof obj !== 'object' || obj === null) continue;
    const o = obj as { type?: unknown; message?: { id?: unknown; content?: unknown } };
    if (o.type !== 'assistant' || o.message?.id !== messageId) continue;
    const c = o.message?.content;
    count += Array.isArray(c) ? c.length : 0;
  }
  return count;
}

/** Optional flush-barrier + poll tuning for {@link syncTranscript}. */
export interface SyncTranscriptOpts {
  /**
   * When set, hold the commit until the file carries `awaitBlocks` content-block
   * lines for this assistant `message.id` — the end-of-turn flush barrier. Null
   * (or absent) reads-and-writes immediately (mid-turn sync, or a turn that
   * emitted no assistant message).
   */
  awaitMessageId?: string | null;
  /** Target content-block count for `awaitMessageId` (see anchor in the design). */
  awaitBlocks?: number;
  /** Poll interval while the barrier is unmet. Default 25ms. */
  pollIntervalMs?: number;
  /** Max poll attempts before a best-effort write. Default 40 (≈ 1s at 25ms). */
  maxPolls?: number;
}

/**
 * Full-file resync of the main transcript into the DB. Reads the ENTIRE
 * `<sdkSessionId>.jsonl` and OVERWRITES `session_transcripts.content` with it
 * verbatim, so `DB.content` byte-equals the file — render-from-DB reproduces the
 * exact live block set. Full-overwrite subsumes fork/truncate (new content fully
 * replaces old, no stale tail) and is idempotent (same file → same content).
 *
 * Flush barrier: when `opts.awaitMessageId` is set, the read is retried until the
 * file holds `opts.awaitBlocks` content-block lines for that assistant message.id
 * (each Claude Code content block is its own JSONL line sharing one id). This
 * pins the end-of-turn commit to CONTENT — the tail thinking/text line is on
 * disk — instead of guessing the subprocess's flush timing. On barrier timeout it
 * writes the best-effort current content and warns; it never throws.
 *
 * Serialize via `ActiveSession.backupMutex` so it cannot interleave with
 * `backupSubagents` or teardown. No-op if the file is missing.
 */
export async function syncTranscript(
  sessionId: string,
  sdkSessionId: string,
  cwd: string,
  opts: SyncTranscriptOpts = {},
): Promise<void> {
  const path = transcriptPath(cwd, sdkSessionId);

  const awaitMessageId = opts.awaitMessageId ?? null;
  const awaitBlocks = opts.awaitBlocks ?? 0;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const maxPolls = opts.maxPolls ?? 40;

  // Read directly and treat a missing file as a skip — avoids the extra
  // `exists()` stat and the TOCTOU window between the two syscalls.
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      log.debug({ sessionId, path }, 'transcript file not found — skipping sync');
      return;
    }
    throw err;
  }

  if (awaitMessageId && awaitBlocks > 0) {
    let have = countAssistantBlocks(content, awaitMessageId);
    let polls = 0;
    while (have < awaitBlocks && polls < maxPolls) {
      await sleep(pollIntervalMs);
      content = await Bun.file(path).text();
      have = countAssistantBlocks(content, awaitMessageId);
      polls += 1;
    }
    if (have < awaitBlocks) {
      log.warn(
        { sessionId, awaitMessageId, awaitBlocks, have },
        'transcript flush barrier timed out — best-effort write',
      );
    }
  }

  const byteOffset = Buffer.byteLength(content, 'utf-8');

  await db
    .insert(sessionTranscripts)
    .values({
      sessionId,
      sdkSessionId,
      workspaceCwd: cwd,
      content,
      byteOffset,
    })
    .onConflictDoUpdate({
      target: sessionTranscripts.sessionId,
      set: {
        content,
        byteOffset,
        sdkSessionId,
        workspaceCwd: cwd,
        updatedAt: new Date(),
      },
    });

  log.debug({ sessionId, bytes: byteOffset }, 'transcript synced');
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

/** Extract plain text from a transcript message `content` (string or content-
 *  block array). Returns '' when no text part is present (e.g. a tool_result-
 *  only user turn). */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        typeof b === 'object' &&
        b !== null &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    )
    .map((b) => b.text)
    .join('');
}

/**
 * Parse transcript JSONL and return the FIRST real user prompt's text — the
 * first non-meta `{"type":"user",…}` entry that carries any text. Skips
 * `isMeta` entries and tool_result-only turns (no text part). Used to seed the
 * self-generated fallback title when the binary wrote no ai-title. Pure (no IO);
 * returns null when no such entry exists.
 */
export function firstUserTextFromJsonl(content: string): string | null {
  for (const line of content.split('\n')) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj !== 'object' || obj === null) continue;
    const o = obj as { type?: unknown; isMeta?: unknown; message?: { content?: unknown } };
    if (o.type !== 'user' || o.isMeta === true) continue;
    const text = messageText(o.message?.content).trim();
    if (text) return text;
  }
  return null;
}

/** The two title inputs read together from one transcript fetch. */
export interface TranscriptTitleInputs {
  /** Binary-written ai-title (last-wins), or null if none yet. */
  aiTitle: string | null;
  /** First real user prompt text, for the self-generated fallback. */
  firstUserText: string | null;
}

/**
 * Read both title inputs from the persisted transcript in a single DB fetch.
 * Survives restarts and `--watch` reloads, so it is the reliable source for
 * titling a session whose turn ran in an earlier runtime. Returns nulls when
 * there is no transcript yet.
 */
export async function readTranscriptTitleInputs(sessionId: string): Promise<TranscriptTitleInputs> {
  const row = await db.query.sessionTranscripts.findFirst({
    where: eq(sessionTranscripts.sessionId, sessionId),
    columns: { content: true },
  });
  const content = row?.content;
  if (!content) return { aiTitle: null, firstUserText: null };
  return { aiTitle: aiTitleFromJsonl(content), firstUserText: firstUserTextFromJsonl(content) };
}

/**
 * Restore the transcript (and any subagent files) from the DB back to the
 * filesystem so the binary can `resume` from them. Recreates the project dir,
 * writes the main JSONL, then writes each subagent entry into the subagent dir.
 *
 * After restore the DB `byteOffset` equals the restored content's byte length.
 * The next `syncTranscript` reads the whole file and overwrites `content`, so the
 * offset is purely the recorded file byte length, kept consistent here when it
 * has drifted from the content.
 */
export async function restoreTranscript(sessionId: string): Promise<void> {
  const row = await db.query.sessionTranscripts.findFirst({
    where: eq(sessionTranscripts.sessionId, sessionId),
  });
  if (!row?.sdkSessionId || !row.content) return;

  // The only internal cwd source (from the DB row, not a parameter). Must use
  // the same per-user projects root as the write path so restore lands where
  // the next append reads — see invariant in `projectsRoot`.
  const dir = join(projectsRoot(row.workspaceCwd), encodeCwd(row.workspaceCwd));
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
