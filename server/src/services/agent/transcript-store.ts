import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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
 *
 * This also equals the SDK's `SessionStore` default `projectKey` for the cwd
 * (same `replace(/[^a-zA-Z0-9]/g,'-')` derivation), so the store key matches.
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
 * Delete a session's local scratch files: the `<sdkSessionId>.jsonl` main
 * transcript and the `<sdkSessionId>/` subtree (subagent transcripts). Used as
 * the delete-local-before-resume guard (forces the SDK `load()` to rematerialize
 * from the DB store, independent of whether `agent-state` is tmpfs or a
 * persistent volume) and as teardown hygiene. Best-effort; a missing file is a
 * no-op. Never touches sibling sessions under the same cwd.
 */
export async function clearLocalSession(cwd: string, sdkSessionId: string): Promise<void> {
  const jsonl = transcriptPath(cwd, sdkSessionId);
  const subtree = join(projectTranscriptDir(cwd), sdkSessionId);
  try {
    await Promise.all([
      rm(jsonl, { force: true }),
      rm(subtree, { recursive: true, force: true }),
    ]);
  } catch (err) {
    log.warn({ err, sdkSessionId, jsonl }, 'failed to clear local session scratch');
  }
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
 * Read both title inputs from the LIVE local transcript JSONL the binary just
 * wrote (`<sdkSessionId>.jsonl`). The local file is the SDK's primary write —
 * the store mirror lags it by up to a frame — so reading local at turn end is
 * the freshest title source and avoids waiting on the mirror. Returns nulls when
 * the file is absent (no transcript yet) or unreadable.
 */
export async function readTranscriptTitleInputs(
  cwd: string,
  sdkSessionId: string,
): Promise<TranscriptTitleInputs> {
  const path = transcriptPath(cwd, sdkSessionId);
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch {
    return { aiTitle: null, firstUserText: null };
  }
  return { aiTitle: aiTitleFromJsonl(content), firstUserText: firstUserTextFromJsonl(content) };
}
