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
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (/^<\/?(?:local-)?command[-a-z]*>/i.test(trimmed)) return false;
  return true;
}

export function renderTranscript(
  content: string,
  subagents?: Record<string, string> | null,
): Block[] {
  const lines = parseLines(content);
  const blocks: Block[] = [];

  // tool_use.id → tool name, built while walking so a later tool_result can
  // resolve its toolName and its originating input for displayBlocks.
  const toolNameByCallId = new Map<string, string>();
  // tool_use.id → the tool_use.input (needed by toDisplayBlocks on result).
  const toolInputByCallId = new Map<string, unknown>();

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

  attachSubagents(blocks, subagents);
  return blocks;
}

/**
 * For each persisted subagent (`agent-<id>.meta.json` + `agent-<id>.jsonl` in
 * the `subagents` map), recursively render its transcript and insert the
 * resulting `subagent` block immediately AFTER its parent Task `tool_call`
 * (matched by `meta.toolUseId` === toolCallId). Older meta lacking `toolUseId`
 * (or with no matching Task) is appended at the end — best-effort, no reliance
 * on positional turn/step indices.
 */
function attachSubagents(blocks: Block[], subagents?: Record<string, string> | null): void {
  if (!subagents) return;

  for (const [filename, fileContents] of Object.entries(subagents)) {
    if (!filename.endsWith('.meta.json')) continue;
    let meta: AnyRecord;
    try {
      const parsed = JSON.parse(fileContents);
      if (!isRecord(parsed)) continue;
      meta = parsed;
    } catch {
      continue;
    }

    const jsonlName = filename.replace(/\.meta\.json$/, '.jsonl');
    const agentJsonl = subagents[jsonlName];
    if (typeof agentJsonl !== 'string') continue;

    const toolUseId = asString(meta.toolUseId);
    const nestedBlocks = renderTranscript(agentJsonl, null);

    const subagentBlock: Block = {
      kind: 'subagent',
      // Without a toolUseId there is no canonical parent id — fall back to the
      // filename's agent id so the block still has a stable, unique id.
      id: toolUseId ? `subagent:${toolUseId}` : `subagent:${jsonlName}`,
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
