import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { eq } from 'drizzle-orm';
import type {
  ErrorPayload,
  StatusUpdatePayload,
  SubagentEventPayload,
  TextDeltaPayload,
  ThinkingDeltaPayload,
  ToolCallDeltaPayload,
  ToolCallPayload,
  ToolResultPayload,
  TurnEndPayload,
  TurnEndStatus,
  WSMessageType,
} from 'shared/types';
import { LIGHT_MODEL } from 'shared/types/providers';
import { db, schema } from '../../db';
import { logger } from '../../lib/logger';
import { broadcastEvent } from '../../lib/ws-broadcast';
import { resolveProviderForUser } from '../providers/resolve';
import type { ActiveSession } from '../session-manager';
import { sessionManager } from '../session-manager';
import { refreshCatalog } from './commands-catalog';
import { toDisplayBlocks } from './display-blocks';
import { generateTitle } from './title';
import { backupSubagents, readTranscriptTitleInputs, syncTranscript } from './transcript-store';

const log = logger.child({ module: 'agent/output-consumer' });

// The `@anthropic-ai/sdk` Beta types are not directly importable here (it ships
// only as a nested dep of the agent SDK, not a top-level package). Derive the
// container types from the agent SDK message types, and restate the block /
// delta / usage shapes locally as the minimal fields this consumer reads. These
// match the wire schema verbatim; narrowing stays defensive on `.type`.
type StreamEvent = SDKPartialAssistantMessage['event'];
type AssistantContentBlock = SDKAssistantMessage['message']['content'][number];

/** Subset of `BetaUsage` token fields consumed by `sumUsage`. */
interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Subset of `BetaToolResultBlockParam` consumed when emitting a tool_result. */
interface ToolResultBlockLike {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}

/** Scope key for per-(sub)agent stream state. Main agent uses `__main__`;
 *  subagents key by their `parent_tool_use_id`, so concurrent subagent streams
 *  track message ids / block indices independently. */
const MAIN_SCOPE = '__main__';

function scopeOf(parentToolUseId: string | null): string {
  return parentToolUseId ?? MAIN_SCOPE;
}

/**
 * Sum every billed token field of an SDK usage object. Defensive on missing
 * fields — the streaming `message_delta` usage and the final `result` usage do
 * not always carry the cache counters.
 */
function sumUsage(usage: UsageLike | null | undefined): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

/** Map a `result` subtype to the wire `turn_end` status. */
function mapTurnStatus(subtype: SDKResultMessage['subtype']): TurnEndStatus {
  switch (subtype) {
    case 'success':
      return 'finished';
    case 'error_max_turns':
      return 'max_steps_reached';
    default:
      // error_during_execution / error_max_budget_usd / error_max_structured_output_retries
      return 'finished';
  }
}

/** Classify a query-iteration error into an `ErrorPayload.code`. */
function classifyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\btimeout\b|ETIMEDOUT|timed out/i.test(message)) return 'timeout';
  if (
    /SIGTERM|SIGKILL|\bkilled\b|spawn ENOENT|ENOENT|EPIPE|ECONNRESET|ECONNREFUSED/i.test(message)
  ) {
    return 'process_died';
  }
  if (/\brate[_\s-]?limit\b|\boverloaded\b|\b529\b|\b503\b/i.test(message)) return 'api_error';
  return 'unknown';
}

/** True for a user abort (cancel / teardown) — not surfaced as an error. */
function isUserAbort(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return /abort(?:ed)?/i.test(message);
}

/**
 * Minimum spacing (ms) between mid-turn subagent checkpoints. `backupSubagents`
 * re-reads the (monotonically growing) subagent JSONL and rewrites the entire
 * `subagents` column, so an unthrottled per-message backup is ~O(messages·size)
 * IO while a subagent streams. Each backup reads the FULL current file, so a
 * later one subsumes every message skipped since the last — and the turn-end
 * flush captures the final state regardless — so this only caps how much
 * streaming progress a crash/F5 can lose (≤ this interval), never a completed
 * subagent.
 */
const SUBAGENT_BACKUP_THROTTLE_MS = 1000;

/**
 * Live streaming consumer for one session's SDK query. Runs for the LIFETIME of
 * the session — the streaming-input `query` stays open across turns, so this
 * `for await` only ends when the bridge closes or the query is aborted. Every
 * SDK message is translated to a WS event via `broadcastEvent` (the sole emit
 * path) and committed to local stream state.
 *
 * Stable-id scheme (MUST match the transcript renderer):
 *  - text/thinking block id = `${message.id}:${contentBlockIndex}`
 *  - tool_call / tool_result id = the `tool_use.id`
 * Subagent activity (`parent_tool_use_id !== null`) is wrapped in a
 * `subagent_event` rather than emitted top-level.
 */
export async function consumeQueryOutput(active: ActiveSession): Promise<void> {
  if (!active.query) {
    log.warn({ sessionId: active.sessionId }, 'consumeQueryOutput called with no query');
    return;
  }

  // ── Local per-session stream state (NOT on ActiveSession) ──
  // The "current" streaming message id per scope (from `message_start`); used to
  // build text/thinking block ids during deltas.
  const currentMessageIdByScope = new Map<string, string>();
  // Per-scope map of contentBlockIndex → tool_use.id, captured at
  // `content_block_start`; used to key `input_json_delta` correctly (the
  // reference bug keyed on msg.uuid — fixed here).
  const toolUseIdByIndex = new Map<string, Map<number, string>>();
  // Original tool input by tool_use.id, captured from the final assistant
  // message. Lets the matching tool_result build richer display blocks.
  const toolInputByCallId = new Map<string, unknown>();
  // Cumulative content-block index per scope, anchored to the current assistant
  // `message.id`. The SDK emits each content block as its OWN length-1 `assistant`
  // message; consecutive messages share one `message.id` and the true block index
  // is the order within that same-id group — matching the streaming `event.index`
  // and the reload renderer's `contentBlockIndex`. (The array-local index is
  // always 0 here, which would collide text onto the first block's id.)
  const assistantBlockCursor = new Map<string, { messageId: string; index: number }>();
  // Wall-clock of the last mid-turn subagent backup that actually ran. Used to
  // throttle checkpoints to ≥ SUBAGENT_BACKUP_THROTTLE_MS apart (see below).
  let lastSubagentBackupAt = 0;

  function getIndexMap(scope: string): Map<number, string> {
    let m = toolUseIdByIndex.get(scope);
    if (!m) {
      m = new Map();
      toolUseIdByIndex.set(scope, m);
    }
    return m;
  }

  /** Routing emit: top-level when no parent, else wrapped as a subagent_event. */
  function emit(parentToolUseId: string | null, type: WSMessageType, payload: unknown): void {
    if (parentToolUseId === null) {
      broadcastEvent(active, type, payload, sessionManager);
      return;
    }
    const wrapped: SubagentEventPayload = {
      parentToolCallId: parentToolUseId,
      inner: { type, payload },
    };
    broadcastEvent(active, 'subagent_event', wrapped, sessionManager);
  }

  /** Capture sdkSessionId from the first message that carries one, persist it. */
  async function captureSessionId(sessionId: string | undefined): Promise<void> {
    if (active.sdkSessionId != null || !sessionId) return;
    active.sdkSessionId = sessionId;
    try {
      await db
        .update(schema.sessions)
        .set({ sdkSessionId: sessionId })
        .where(eq(schema.sessions.id, active.sessionId));
    } catch (err) {
      log.error({ err, sessionId: active.sessionId }, 'failed to persist sdkSessionId');
    }
  }

  /** Chain a transcript backup on the per-session mutex (fire-and-forget). */
  function chainBackup(fn: () => Promise<void>): void {
    active.backupMutex = active.backupMutex.then(fn).catch((err) => {
      log.error({ err, sessionId: active.sessionId }, 'transcript backup failed');
    });
  }

  /** Read the subagent JSONL from disk into the `subagents` column. No-op without an sdkSessionId. */
  function backupSubagentsNow(): Promise<void> {
    if (!active.sdkSessionId) return Promise.resolve();
    return backupSubagents(active.sessionId, active.sdkSessionId, active.workDir);
  }

  /**
   * Throttled mid-turn subagent backup. While a subagent streams, the main agent
   * is blocked on the Task tool, so the main-scope `syncTranscript` never fires —
   * and `backupSubagents` otherwise only ran at turn end, so a F5 mid-turn lost
   * the entire subagent (its JSONL was on disk but never in the `subagents`
   * column the snapshot renders from). Checkpoint it here, bounded two ways:
   *  - the `subagentBackupQueued` latch coalesces a burst into at most one queued
   *    backup beyond the one in flight (cleared when the backup starts, so the
   *    next message re-arms a fresh checkpoint);
   *  - a `SUBAGENT_BACKUP_THROTTLE_MS` time gate skips the run if one happened
   *    too recently — re-checked inside the chained task so a backup deferred
   *    behind slow IO still fires once the interval has elapsed.
   */
  function chainSubagentBackup(): void {
    if (!active.sdkSessionId || active.subagentBackupQueued) return;
    active.subagentBackupQueued = true;
    chainBackup(async () => {
      active.subagentBackupQueued = false;
      const now = Date.now();
      if (now - lastSubagentBackupAt < SUBAGENT_BACKUP_THROTTLE_MS) return;
      lastSubagentBackupAt = now;
      await backupSubagentsNow();
    });
  }

  function handleStreamEvent(msg: SDKPartialAssistantMessage): void {
    const parent = msg.parent_tool_use_id;
    const scope = scopeOf(parent);
    const event: StreamEvent = msg.event;

    switch (event.type) {
      case 'message_start': {
        currentMessageIdByScope.set(scope, event.message.id);
        break;
      }
      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          getIndexMap(scope).set(event.index, block.id);
          active.toolNameByCallId.set(block.id, block.name);
          const payload: ToolCallPayload = { id: block.id, name: block.name, arguments: {} };
          emit(parent, 'tool_call', payload);
        }
        // text / thinking: no event needed — the first delta creates the block.
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta;
        const mid = currentMessageIdByScope.get(scope);
        switch (delta.type) {
          case 'text_delta': {
            if (mid == null) break;
            const payload: TextDeltaPayload = { id: `${mid}:${event.index}`, text: delta.text };
            emit(parent, 'text_delta', payload);
            break;
          }
          case 'thinking_delta': {
            if (mid == null) break;
            const payload: ThinkingDeltaPayload = {
              id: `${mid}:${event.index}`,
              thinking: delta.thinking,
            };
            emit(parent, 'thinking_delta', payload);
            break;
          }
          case 'input_json_delta': {
            const toolUseId = getIndexMap(scope).get(event.index);
            if (!toolUseId) break;
            const payload: ToolCallDeltaPayload = {
              id: toolUseId,
              argumentsPart: delta.partial_json,
            };
            emit(parent, 'tool_call_delta', payload);
            break;
          }
          // signature_delta / citations_delta / compaction → ignore.
          default:
            break;
        }
        break;
      }
      // content_block_stop / message_delta / message_stop → the final assistant
      // message drives the idempotent commit; nothing to do here.
      default:
        break;
    }
  }

  function handleAssistant(msg: SDKAssistantMessage): void {
    const parent = msg.parent_tool_use_id;
    const scope = scopeOf(parent);
    const messageId = msg.message.id;
    const content: AssistantContentBlock[] = msg.message.content ?? [];

    // Resolve the running block index for this message.id within this scope,
    // resetting whenever the id changes (a new assistant message group begins).
    let cursor = assistantBlockCursor.get(scope);
    if (!cursor || cursor.messageId !== messageId) {
      cursor = { messageId, index: 0 };
      assistantBlockCursor.set(scope, cursor);
    }

    for (const block of content) {
      // Advance for EVERY block (incl. tool_use) so the index stays aligned with
      // the streaming `event.index` and the reload renderer.
      const blockIndex = cursor.index++;
      switch (block.type) {
        case 'text': {
          const payload: TextDeltaPayload = {
            id: `${messageId}:${blockIndex}`,
            text: block.text,
            final: true,
          };
          emit(parent, 'text_delta', payload);
          break;
        }
        case 'thinking': {
          const payload: ThinkingDeltaPayload = {
            id: `${messageId}:${blockIndex}`,
            thinking: block.thinking,
            encrypted: !block.thinking && !!block.signature,
            final: true,
          };
          emit(parent, 'thinking_delta', payload);
          break;
        }
        case 'redacted_thinking': {
          // No streamed text — emit a final, encrypted (signature-only) block.
          const payload: ThinkingDeltaPayload = {
            id: `${messageId}:${blockIndex}`,
            thinking: '',
            encrypted: true,
            final: true,
          };
          emit(parent, 'thinking_delta', payload);
          break;
        }
        case 'tool_use': {
          active.toolNameByCallId.set(block.id, block.name);
          toolInputByCallId.set(block.id, block.input);
          const payload: ToolCallPayload = {
            id: block.id,
            name: block.name,
            arguments: block.input,
          };
          emit(parent, 'tool_call', payload);
          break;
        }
        default:
          break;
      }
    }

    // Main scope only: anchor the end-of-turn flush barrier and keep the DB
    // snapshot fresh mid-turn. `cursor.index` is now the total content-block
    // count seen for this message.id; the LAST assistant message of the turn
    // leaves the anchor pointing at the tail the barrier must wait for.
    if (parent === null) {
      active.lastMainAssistantId = messageId;
      active.lastMainAssistantBlocks = cursor.index;
      if (active.sdkSessionId) {
        const sdkSessionId = active.sdkSessionId;
        const cwd = active.workDir;
        // Mid-turn sync: no barrier — keep snapshot/F5 fresh between turns.
        chainBackup(() => syncTranscript(active.sessionId, sdkSessionId, cwd));
      }
    } else {
      // Subagent assistant message: the main transcript is unchanged (the main
      // agent is parked on the Task tool), so the sync above never fires while a
      // subagent streams. Checkpoint the subagent JSONL into the `subagents`
      // column so a mid-turn F5 restores the subagent's progress instead of an
      // empty Task card.
      chainSubagentBackup();
    }
  }

  function handleUser(msg: SDKUserMessage): void {
    const parent = msg.parent_tool_use_id;
    const content = msg.message.content;

    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (
        typeof block !== 'object' ||
        block === null ||
        (block as { type?: unknown }).type !== 'tool_result'
      ) {
        continue;
      }
      const tr = block as ToolResultBlockLike;
      const toolName = active.toolNameByCallId.get(tr.tool_use_id) ?? '';
      const input = toolInputByCallId.get(tr.tool_use_id);
      const payload: ToolResultPayload = {
        toolCallId: tr.tool_use_id,
        output: tr.content,
        isError: tr.is_error === true,
        displayBlocks: toDisplayBlocks(toolName, input, tr.content, msg.tool_use_result),
      };
      emit(parent, 'tool_result', payload);
    }
  }

  function handleSystem(msg: SDKMessage & { type: 'system' }): void {
    switch (msg.subtype) {
      case 'init': {
        // Capture the session's dynamic command/skill catalog and refresh it
        // (detached: the rich-metadata fetch + broadcast must not block the pump).
        void refreshCatalog(active, msg.slash_commands, msg.skills, sessionManager).catch((err) => {
          log.error({ err, sessionId: active.sessionId }, 'failed to refresh command catalog');
        });
        break;
      }
      case 'compact_boundary': {
        broadcastEvent(active, 'compaction_begin', {}, sessionManager);
        broadcastEvent(active, 'compaction_end', {}, sessionManager);
        break;
      }
      case 'task_started': {
        const t = msg as SDKTaskStartedMessage;
        if (t.tool_use_id) {
          const payload: SubagentEventPayload = {
            parentToolCallId: t.tool_use_id,
            ...(t.subagent_type ? { subagentType: t.subagent_type } : {}),
            description: t.description,
            inner: null,
          };
          broadcastEvent(active, 'subagent_event', payload, sessionManager);
        }
        break;
      }
      case 'task_notification': {
        const t = msg as SDKTaskNotificationMessage;
        if (t.tool_use_id) {
          const turnEnd: TurnEndPayload = { status: 'finished', steps: 0 };
          const payload: SubagentEventPayload = {
            parentToolCallId: t.tool_use_id,
            inner: { type: 'turn_end', payload: turnEnd },
          };
          broadcastEvent(active, 'subagent_event', payload, sessionManager);
          // Subagent finished — flush its complete JSONL now (not debounced) so a
          // F5 between this subagent ending and the main turn ending still
          // restores the finished subagent in full.
          chainBackup(backupSubagentsNow);
        }
        break;
      }
      // task_progress / task_updated / thinking_tokens / permission_denied /
      // status / api_retry / etc. → skipped (no client-facing surface in MVP).
      default:
        break;
    }
  }

  async function handleResult(msg: SDKResultMessage): Promise<void> {
    const tokenUsage = sumUsage(msg.usage);
    const status: StatusUpdatePayload = {
      tokenUsage,
      totalCostUsd: msg.total_cost_usd,
    };
    active.lastStatusUpdate = status;
    broadcastEvent(active, 'status_update', status, sessionManager);

    // total_cost_usd is cumulative for the whole SDK session → set, not add.
    try {
      await db
        .update(schema.sessions)
        .set({
          totalTokens: tokenUsage,
          totalCostUsd: String(msg.total_cost_usd ?? 0),
          lastActiveAt: new Date(),
        })
        .where(eq(schema.sessions.id, active.sessionId));
    } catch (err) {
      log.error({ err, sessionId: active.sessionId }, 'failed to persist turn usage');
    }

    const turnEnd: TurnEndPayload = { status: mapTurnStatus(msg.subtype), steps: msg.num_turns };
    broadcastEvent(active, 'turn_end', turnEnd, sessionManager);
    active.turnInProgress = false;

    // Post-turn transcript + subagent backup (fire-and-forget, serialized). The
    // transcript sync runs the flush barrier on the turn's last main assistant
    // message, so it only commits once the tail thinking/text line is on disk.
    if (active.sdkSessionId) {
      const sdkSessionId = active.sdkSessionId;
      const cwd = active.workDir;
      const awaitMessageId = active.lastMainAssistantId;
      const awaitBlocks = active.lastMainAssistantBlocks;
      chainBackup(() =>
        syncTranscript(active.sessionId, sdkSessionId, cwd, { awaitMessageId, awaitBlocks }),
      );
      chainBackup(() => backupSubagents(active.sessionId, sdkSessionId, cwd));
    }

    // Title is read from the freshly backed-up transcript, so wait for the
    // serialized backup chain to drain before looking for the ai-title entry.
    await active.backupMutex;
    await maybePersistTitle();
  }

  /** Persist a title + its provenance, then broadcast the update. */
  async function persistTitle(title: string, source: 'ai' | 'fallback'): Promise<void> {
    try {
      await db
        .update(schema.sessions)
        .set({ title, titleSource: source })
        .where(eq(schema.sessions.id, active.sessionId));
    } catch (err) {
      log.error({ err, sessionId: active.sessionId }, 'failed to persist title');
      return;
    }
    broadcastEvent(active, 'title_update', { title }, sessionManager);
    log.info({ sessionId: active.sessionId, title, source }, 'title persisted');
  }

  /**
   * Settle the session's title on turn end. The `claude` binary normally writes
   * a `{"type":"ai-title",…}` entry into the transcript for free during a turn,
   * but a 3rd-party proxy can drop that background generation (notably on short
   * sessions), leaving the entry absent. So:
   *
   *  - `manual` source → leave the user's title alone.
   *  - binary ai-title present → mirror it as `ai` (overriding any prior
   *    `fallback`, kept in sync if the binary rewrites it).
   *  - no ai-title yet & still untitled → self-generate a `fallback` title from
   *    the first user prompt; a later binary ai-title supersedes it.
   *
   * Re-evaluated every turn end while the title is not yet `ai`, so a deferred
   * binary title (or one written in an earlier runtime) is still picked up.
   */
  async function maybePersistTitle(): Promise<void> {
    let row: { title: string | null; titleSource: string | null } | undefined;
    try {
      row = await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, active.sessionId),
        columns: { title: true, titleSource: true },
      });
    } catch (err) {
      log.warn({ err, sessionId: active.sessionId }, 'title lookup failed');
      return;
    }
    if (row?.titleSource === 'manual') return; // user-set — never overwrite

    const { aiTitle, firstUserText } = await readTranscriptTitleInputs(active.sessionId);

    // Binary's own title wins whenever present: adopt it, overriding a fallback.
    if (aiTitle) {
      const clamped = aiTitle.slice(0, 255);
      if (row?.title === clamped && row?.titleSource === 'ai') return; // already mirrored
      await persistTitle(clamped, 'ai');
      return;
    }

    // No binary title. Generate our own only while still untitled — an existing
    // fallback is kept (the binary may still supersede it on a later turn).
    if (row?.title) return;
    if (!firstUserText) return;

    const provider = await resolveProviderForUser(db, active.userId, active.providerId);
    if (!provider) return;

    // An api proxy may not expose the Anthropic light model id, so reuse the
    // session's resolved model there; oauth always has the light model.
    const titleModel = provider.type === 'api' ? (active.model ?? LIGHT_MODEL) : LIGHT_MODEL;

    let title: string | null;
    try {
      title = await generateTitle(firstUserText, provider, titleModel);
    } catch (err) {
      log.warn({ err, sessionId: active.sessionId }, 'title generation threw');
      return;
    }
    if (!title) return;
    await persistTitle(title.slice(0, 255), 'fallback');
  }

  log.info({ sessionId: active.sessionId }, 'output consumer started');
  try {
    for await (const msg of active.query) {
      await captureSessionId(msg.session_id);

      switch (msg.type) {
        case 'stream_event':
          handleStreamEvent(msg);
          break;
        case 'assistant':
          handleAssistant(msg);
          break;
        case 'user':
          handleUser(msg);
          break;
        case 'system':
          handleSystem(msg);
          break;
        case 'result':
          await handleResult(msg);
          break;
        // user_replay / rate_limit_event / tool_progress / task_progress /
        // hook_* / etc. → no client-facing surface in MVP.
        default:
          break;
      }
    }
  } catch (err) {
    if (isUserAbort(err)) {
      log.info({ sessionId: active.sessionId }, 'query aborted');
    } else {
      const code = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, sessionId: active.sessionId, code }, 'query iteration error');
      const payload: ErrorPayload = { code, message, retryable: false };
      broadcastEvent(active, 'error', payload, sessionManager);
    }
    active.turnInProgress = false;
    // Never leave a canUseTool promise hanging on iteration failure/teardown.
    sessionManager.drainPendingRequests(active);
  }

  log.info({ sessionId: active.sessionId }, 'output consumer ended');
}
