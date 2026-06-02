// Pure renderer: Claude Code JSONL transcript → flat `Block[]`. No DB, no fs,
// no SDK — trivially testable. This is the persisted/reload path; every block
// is marked `isStreaming:false`. The live output-consumer emits the SAME
// stable ids (see the LOCKED scheme below) so a reload reconciles cleanly.
//
// Claude Code JSONL shape (verified on disk):
//  - one JSON object per line;
//  - `message.content` for an assistant line is ALWAYS an array of length 1
//    (Claude Code splits each content block onto its own line). Consecutive
//    assistant lines share one `message.id` (`msg_…`); the content-block index
//    = order within that same-id group.
//  - `type:'user'` `message.content` is EITHER a string (real prompt) OR an
//    array of `{type:'tool_result', tool_use_id, content, is_error}`.
//
// Stable-id scheme (must match the live consumer):
//  - text/thinking id = `${message.id}:${contentBlockIndex}`
//  - tool_call id / toolCallId = the `tool_use.id` (`toolu_…`)
//  - tool_result id = the matching `tool_use.id` (from `tool_result.tool_use_id`)
//  - subagent id = `subagent:${parentToolUseId}` (parent Task `tool_use.id`)
//  - user id = the user line's `uuid`
//  - error id = `error:${i}` (sequential within the render)

import type { Block, DisplayBlock } from 'shared/types';
import { toDisplayBlocks } from './display-blocks';

/**
 * Structural transcript entry — a JSONL line as a POJO. Matches the SDK's
 * `SessionStoreEntry` without a runtime dependency, keeping this renderer pure.
 */
type TranscriptEntry = { type: string; [k: string]: unknown };

// Line types that carry no renderable content — bookkeeping only.
const IGNORED_LINE_TYPES = new Set([
  'system',
  'queue-operation',
  'last-prompt',
  'mode',
  'permission-mode',
  'bridge-session',
  'attachment',
  'ai-title',
  'file-history-snapshot',
  'summary',
]);

interface AnyRecord {
  [key: string]: unknown;
}

/** Render-time options for {@link renderTranscript}. */
export interface RenderOpts {
  /**
   * The turn is NOT live (snapshot of a finished/abandoned session — e.g. a
   * server restart killed it mid-flight). Synthesize a `synthetic:'interrupted'`
   * tool_result for every tool_call left without one, so the UI shows a halted
   * marker instead of a perpetual spinner. Default false (live reconcile path),
   * where a dangling tool_call IS genuinely still running.
   */
  terminal?: boolean;
}

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Parse the JSONL body line-by-line, tolerating blank/malformed lines. */
function parseLines(content: string): AnyRecord[] {
  const out: AnyRecord[] = [];
  if (!content) return out;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (isRecord(rec)) out.push(rec);
    } catch {
      // Skip malformed lines — same tolerance as the old parseWireFromBytes.
    }
  }
  return out;
}

/**
 * A pure user-prompt string is renderable; command-wrapper / meta lines are
 * bookkeeping. Drop `isMeta` lines and content that is only a `<command-*>` /
 * `<local-command-*>` wrapper.
 */
function isRenderableUserString(rec: AnyRecord, content: string): boolean {
  if (rec.isMeta === true) return false;
  // Compaction summary lines (`/compact` or auto-compact) are `type:'user'`
  // with a large string body. They are bookkeeping injected for the model, not
  // a prompt the user typed — the live path never renders them as a bubble
  // (it surfaces compaction via the compaction_begin/end events), so drop them
  // on reload too.
  if (rec.isCompactSummary === true) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (/^<\/?(?:local-)?command[-a-z]*>/i.test(trimmed)) return false;
  return true;
}

export function renderTranscript(
  content: string,
  subagents?: Record<string, string> | null,
  opts: RenderOpts = {},
): Block[] {
  const lines = parseLines(content);
  const blocks: Block[] = [];

  // tool_use.id → tool name, built while walking so a later tool_result can
  // resolve its toolName and its originating input for displayBlocks.
  const toolNameByCallId = new Map<string, string>();
  // tool_use.id → the tool_use.input (needed by toDisplayBlocks on result).
  const toolInputByCallId = new Map<string, unknown>();
  // subagent agentId (the `agent-<id>` file stem) → parent Task tool_use.id.
  // Recovered from a tool_result line's `toolUseResult.agentId`; lets
  // attachSubagents nest a subagent under its Task even when the subagent's
  // meta.json omits `toolUseId` (older binaries wrote only agentType/description).
  const agentIdToParent = new Map<string, string>();

  // contentBlockIndex bookkeeping: reset the per-message counter whenever the
  // assistant `message.id` changes (consecutive same-id lines increment it).
  let currentMessageId: string | null = null;
  let contentBlockIndex = 0;
  let errorSeq = 0;

  for (const rec of lines) {
    const type = asString(rec.type);
    if (IGNORED_LINE_TYPES.has(type)) continue;
    const timestamp = asString(rec.timestamp);

    if (type === 'assistant') {
      const message = isRecord(rec.message) ? rec.message : undefined;
      if (!message) continue;
      const messageId = asString(message.id);
      if (messageId !== currentMessageId) {
        currentMessageId = messageId;
        contentBlockIndex = 0;
      }
      const contentArr = Array.isArray(message.content) ? message.content : [];
      for (const raw of contentArr) {
        if (!isRecord(raw)) {
          contentBlockIndex++;
          continue;
        }
        const blockType = asString(raw.type);
        const id = `${messageId}:${contentBlockIndex}`;
        if (blockType === 'text') {
          blocks.push({
            kind: 'text',
            id,
            content: asString(raw.text),
            isStreaming: false,
            createdAt: timestamp,
          });
        } else if (blockType === 'thinking') {
          const thinking = asString(raw.thinking);
          // Empty thinking + a signature ⇒ redacted/encrypted thinking.
          const encrypted = thinking === '' && asString(raw.signature) !== '';
          blocks.push({
            kind: 'thinking',
            id,
            content: thinking,
            encrypted,
            isStreaming: false,
            createdAt: timestamp,
          });
        } else if (blockType === 'tool_use') {
          const toolCallId = asString(raw.id);
          const name = asString(raw.name);
          toolNameByCallId.set(toolCallId, name);
          toolInputByCallId.set(toolCallId, raw.input);
          blocks.push({
            kind: 'tool_call',
            id: toolCallId,
            toolCallId,
            name,
            args: raw.input ?? {},
            isStreaming: false,
            createdAt: timestamp,
          });
        }
        contentBlockIndex++;
      }
      continue;
    }

    if (type === 'user') {
      // A user line breaks any assistant message grouping.
      currentMessageId = null;
      const message = isRecord(rec.message) ? rec.message : undefined;
      const rawContent = message?.content;

      if (typeof rawContent === 'string') {
        if (isRenderableUserString(rec, rawContent)) {
          blocks.push({
            kind: 'user',
            id: asString(rec.uuid),
            content: rawContent,
            createdAt: timestamp,
            status: 'sent',
          });
        }
        continue;
      }

      if (Array.isArray(rawContent)) {
        for (const item of rawContent) {
          if (!isRecord(item)) continue;
          if (asString(item.type) !== 'tool_result') continue;
          const toolUseId = asString(item.tool_use_id);
          // Record the agentId → parent-Task linkage for subagent nesting.
          const tur = isRecord(rec.toolUseResult) ? rec.toolUseResult : undefined;
          const agentId = tur ? asString(tur.agentId) : '';
          if (agentId && toolUseId) agentIdToParent.set(agentId, toolUseId);
          const toolName = toolNameByCallId.get(toolUseId) ?? '';
          const toolInput = toolInputByCallId.get(toolUseId);
          let displayBlocks: DisplayBlock[] = [];
          try {
            displayBlocks = toDisplayBlocks(toolName, toolInput, item.content, rec.toolUseResult);
          } catch {
            displayBlocks = [];
          }
          blocks.push({
            kind: 'tool_result',
            id: toolUseId,
            toolCallId: toolUseId,
            toolName,
            output: item.content,
            message: null,
            displayBlocks,
            // is_error missing / null ⇒ NOT an error.
            isError: item.is_error === true,
            createdAt: timestamp,
          });
        }
        continue;
      }
      continue;
    }

    // Any non-ignored, non-handled type that explicitly marks an error.
    if (type === 'error') {
      blocks.push({
        kind: 'error',
        id: `error:${errorSeq++}`,
        code: asString(rec.code) || 'error',
        message: asString(rec.message) || asString(rec.error),
        createdAt: timestamp,
      });
    }
  }

  attachSubagents(blocks, subagents, agentIdToParent, opts);
  if (opts.terminal) synthesizeInterruptedResults(blocks);
  return blocks;
}

/**
 * SDK subagent-mirror wire format. The `.meta.json` sidecar is mirrored into the
 * store as a transcript entry tagged with `AGENT_METADATA_TYPE`; `renderEntries`
 * splits it back out. The `agent-<id>` stem plus the `.jsonl`/`.meta.json`
 * filename pair are the on-disk shape `attachSubagents` keys on. Kept in one
 * place so the encode (renderEntries) and decode (attachSubagents) cannot drift.
 */
const AGENT_METADATA_TYPE = 'agent_metadata';
const AGENT_STEM_PREFIX = 'agent-';
const JSONL_EXT = '.jsonl';
const META_EXT = '.meta.json';

/**
 * Render directly from `SessionStore` entries (the store-backed reload path).
 * Reconstructs the JSONL inputs `renderTranscript` expects:
 *  - main: each entry serialized back to one JSONL line.
 *  - subagents: per subpath `subagents/agent-<id>`, split the `agent_metadata`
 *    entry (the mirrored `.meta.json`, stored as `{type:'agent_metadata',…}`)
 *    from the transcript entries, rebuilding the `agent-<id>.jsonl` +
 *    `agent-<id>.meta.json` pair `attachSubagents` keys on.
 */
export function renderEntries(
  mainEntries: TranscriptEntry[],
  subagents: Map<string, TranscriptEntry[]>,
  opts: RenderOpts = {},
): Block[] {
  const content = mainEntries.map((e) => JSON.stringify(e)).join('\n');

  const subagentFiles: Record<string, string> = {};
  for (const [subpath, entries] of subagents) {
    // `subagents/agent-<id>` → `agent-<id>` file stem.
    const stem = subpath.split('/').pop() ?? subpath;
    const transcript: TranscriptEntry[] = [];
    let meta: TranscriptEntry | null = null;
    for (const e of entries) {
      if (e.type === AGENT_METADATA_TYPE) meta = e; // last-wins
      else transcript.push(e);
    }
    subagentFiles[`${stem}${JSONL_EXT}`] = transcript.map((e) => JSON.stringify(e)).join('\n');
    if (meta) {
      // The SDK mirrored `.meta.json` as `{type:'agent_metadata', ...meta}`;
      // strip the discriminant to recover the original sidecar object.
      const { type: _discard, ...metaObj } = meta;
      subagentFiles[`${stem}${META_EXT}`] = JSON.stringify(metaObj);
    }
  }

  return renderTranscript(content, subagentFiles, opts);
}

/**
 * Terminal-snapshot repair: a turn killed mid-flight (e.g. a server restart)
 * leaves tool_calls with no matching tool_result on disk. The live UI infers
 * "no result ⇒ still running" and spins forever. For each such dangling
 * tool_call, splice a `synthetic:'interrupted'` tool_result immediately after it
 * so the rail pairs them in the SAME segment (status → interrupted, a static
 * halted marker) and a subagent bundle surfaces a "Subagent Halted" result.
 * Mutates `blocks` in place. Idempotent: a tool_call that already has a result
 * (real or synthetic) is left untouched.
 */
function synthesizeInterruptedResults(blocks: Block[]): void {
  const haveResult = new Set<string>();
  for (const b of blocks) {
    if (b.kind === 'tool_result') haveResult.add(b.toolCallId);
  }

  const out: Block[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.kind !== 'tool_call' || haveResult.has(b.toolCallId)) continue;
    haveResult.add(b.toolCallId);
    out.push({
      kind: 'tool_result',
      id: `interrupted:${b.toolCallId}`,
      toolCallId: b.toolCallId,
      toolName: b.name,
      output: null,
      message: 'Interrupted — the turn ended before this tool returned.',
      displayBlocks: [],
      isError: false,
      synthetic: 'interrupted',
      createdAt: b.createdAt,
    });
  }
  blocks.length = 0;
  blocks.push(...out);
}

/**
 * For each persisted subagent (`agent-<id>.meta.json` + `agent-<id>.jsonl` in
 * the `subagents` map), recursively render its transcript and insert the
 * resulting `subagent` block immediately AFTER its parent Task `tool_call`.
 * The parent id is `meta.toolUseId` when present, else recovered from
 * `agentIdToParent` (built from `toolUseResult.agentId` on the Task's result
 * line — the linkage that survives meta.json omitting `toolUseId`). A subagent
 * with no resolvable parent is appended at the end — best-effort, no reliance
 * on positional turn/step indices.
 */
function attachSubagents(
  blocks: Block[],
  subagents: Record<string, string> | null | undefined,
  agentIdToParent: Map<string, string>,
  opts: RenderOpts,
): void {
  if (!subagents) return;

  for (const [filename, fileContents] of Object.entries(subagents)) {
    if (!filename.endsWith(META_EXT)) continue;
    let meta: AnyRecord;
    try {
      const parsed = JSON.parse(fileContents);
      if (!isRecord(parsed)) continue;
      meta = parsed;
    } catch {
      continue;
    }

    // `agent-<id>.meta.json` → `agent-<id>` (suffix guaranteed by the guard above).
    const stem = filename.slice(0, -META_EXT.length);
    const agentJsonl = subagents[`${stem}${JSONL_EXT}`];
    if (typeof agentJsonl !== 'string') continue;

    // `agent-<agentId>` → agentId; resolve parent: explicit meta field first,
    // else the agentId↔tool_result linkage recovered while walking.
    const agentId = stem.startsWith(AGENT_STEM_PREFIX) ? stem.slice(AGENT_STEM_PREFIX.length) : stem;
    const toolUseId = asString(meta.toolUseId) || agentIdToParent.get(agentId) || '';
    const nestedBlocks = renderTranscript(agentJsonl, null, opts);

    const subagentBlock: Block = {
      kind: 'subagent',
      // Without a toolUseId there is no canonical parent id — fall back to the
      // filename's agent id so the block still has a stable, unique id.
      id: toolUseId ? `subagent:${toolUseId}` : `subagent:${stem}${JSONL_EXT}`,
      parentToolCallId: toolUseId,
      ...(asString(meta.agentType) ? { subagentType: asString(meta.agentType) } : {}),
      ...(asString(meta.description) ? { description: asString(meta.description) } : {}),
      blocks: nestedBlocks,
      isStreaming: false,
      createdAt: '',
    };

    const parentIdx = toolUseId
      ? blocks.findIndex((b) => b.kind === 'tool_call' && b.toolCallId === toolUseId)
      : -1;
    if (parentIdx !== -1) {
      blocks.splice(parentIdx + 1, 0, subagentBlock);
    } else {
      blocks.push(subagentBlock);
    }
  }
}
