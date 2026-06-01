// Shared client/server wire contract.
// Server and client must agree on this surface verbatim.

import type { CommandInfo } from './commands';
import type { GitProvider } from './types/git-credentials';

// ─────────────────────────── WebSocket envelope ───────────────────────────

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  payload: T;
  sessionId: string;
  /** Server-assigned monotonic counter per session. */
  seq: number;
  /** Unix epoch ms. */
  timestamp: number;
}

export type WSMessageType =
  // server → client
  | 'snapshot'
  | 'replay_done'
  | 'turn_begin'
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_call'
  | 'tool_call_delta'
  | 'tool_result'
  | 'subagent_event'
  | 'status_update'
  | 'approval_request'
  | 'approval_response'
  | 'question_request'
  | 'compaction_begin'
  | 'compaction_end'
  | 'turn_end'
  | 'session_created'
  | 'session_updated'
  | 'title_update'
  | 'project_adopted'
  | 'clone_progress'
  | 'commands_available'
  | 'context_usage'
  | 'error'
  // client → server
  | 'subscribe'
  | 'create_session'
  | 'resume_session'
  | 'send_message'
  | 'approve_tool'
  | 'answer_question'
  | 'interrupt_turn'
  | 'adopt_project'
  | 'request_context_usage'
  | 'compact_session';

// ─────────────────────────── Domain types ───────────────────────────

export const APPROVAL_MODES = ['ask', 'safe', 'bypass'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
/** Reasoning effort exposed in the composer. `null` means the provider default. */
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type DisplayBlock =
  | { type: 'shell'; command: string; language: string }
  | { type: 'diff'; path: string; oldText: string; newText: string }
  | { type: 'todo'; items: { title: string; status: 'pending' | 'in_progress' | 'done' }[] }
  | { type: 'brief'; text: string }
  | { type: 'unknown'; rawType: string; raw: Record<string, unknown> };

export type Block =
  | { kind: 'user'; id: string; content: string; createdAt: string; status?: 'pending' | 'sent' }
  | {
      // id = `${message.id}:${contentBlockIndex}` — stable across live & reload.
      kind: 'text';
      id: string;
      content: string;
      isStreaming: boolean;
      createdAt: string;
    }
  | {
      // id = `${message.id}:${contentBlockIndex}`. `encrypted` = redacted thinking
      // (empty text, signature-only).
      kind: 'thinking';
      id: string;
      content: string;
      encrypted: boolean;
      isStreaming: boolean;
      createdAt: string;
    }
  | {
      kind: 'tool_call';
      id: string;
      toolCallId: string;
      name: string;
      args: unknown;
      argsStreaming?: string;
      isStreaming: boolean;
      createdAt: string;
    }
  | {
      kind: 'tool_result';
      id: string;
      toolCallId: string;
      toolName: string;
      output: unknown;
      message: string | null;
      displayBlocks: DisplayBlock[];
      isError: boolean;
      synthetic?: 'interrupted';
      createdAt: string;
    }
  | {
      // id = `subagent:${parentToolCallId}` where parentToolCallId is the Task
      // tool_use.id. Nested blocks are attached at render time (live: routed by
      // SDK `parent_tool_use_id`; reload: from the `subagents` JSONB via
      // meta.toolUseId). `subagentType`/`description` come from `task_started`.
      kind: 'subagent';
      id: string;
      parentToolCallId: string;
      subagentType?: string;
      description?: string;
      blocks: Block[];
      isStreaming: boolean;
      createdAt: string;
    }
  | {
      kind: 'approval_request';
      id: string;
      requestId: string;
      toolCallId: string;
      action: string;
      description: string;
      resolution?: 'approve' | 'approve_for_session' | 'reject';
      createdAt: string;
    }
  | {
      kind: 'question_request';
      id: string;
      requestId: string;
      /** SDK `QuestionRequest.tool_call_id` — used to detect "answered" via matching tool_result. */
      toolCallId: string;
      questions: QuestionItemDTO[];
      /** True once the question's tool_call has resolved (user has answered). */
      resolved?: boolean;
      createdAt: string;
    }
  | { kind: 'error'; id: string; code: string; message: string; createdAt: string };

export interface SessionListItem {
  id: string;
  /** Cached last-known absolute workDir from the DB. May differ from the local machine path. */
  workDir: string;
  /** Logical project slug, sourced from the `sessions.projectName` DB column. */
  projectName: string;
  /** Server-computed `<WORKSPACE_ROOT>/<userSlug>/<projectName>` for the current machine. */
  localWorkDir: string;
  /** `local` when `workDir === localWorkDir`; `foreign` otherwise. */
  origin: 'local' | 'foreign';
  title: string | null;
  /**
   * First user prompt (whitespace-normalized, length-capped), or null when the
   * session has no transcript yet. The client shows this as a provisional title
   * until a real `title` (binary ai-title or self-generated fallback) is set —
   * it is never persisted to the `title` column.
   */
  firstUserText: string | null;
  model: string | null;
  /** Provider that owns `model`; null when unset or orphaned. */
  providerId: string | null;
  thinking: boolean;
  totalTokens: number;
  totalCostUsd: number;
  createdAt: string;
  lastActiveAt: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number;
  /** Unix epoch ms. */
  mtime: number;
}

export interface QuestionOptionDTO {
  label: string;
  description?: string;
  /** Per-option preview content for AskUserQuestion; from the SDK option's `preview` field. */
  preview?: string;
}

export interface QuestionItemDTO {
  question: string;
  header?: string;
  options: QuestionOptionDTO[];
  /** Mirrors the SDK camelCase `multiSelect` field. */
  multiSelect?: boolean;
}

// ─────────────────────────── Server → Client payloads ───────────────────────────

export interface SnapshotPayload {
  blocks: Block[];
  totalTokens: number;
  totalCostUsd: number;
  title: string | null;
  pendingPrompt: { text: string; enqueuedAt: string } | null;
  /**
   * Per-session agent flags, sourced from the sessions row (re-read on restore).
   * Carried in the snapshot so the composer's approval/thinking selectors
   * reflect the true server state after reload — not a stale local default.
   */
  thinking: boolean;
  approvalMode: ApprovalMode;
  /** Reasoning effort, applied from the prompt it rides with onward; `null` is the provider default. */
  effort: EffortLevel | null;
  /**
   * Dynamic command/skill catalog for this session's workDir, captured from the
   * live session's `system/init`. Empty until the first turn populates it.
   */
  commands: CommandInfo[];
  live: {
    /** True iff the server still has an in-flight turn for this session. */
    turnInProgress: boolean;
  };
  /**
   * In-memory cached context-window usage, so the snapshot paints the context
   * panel instantly before the sidebar's open-request round-trips. Null when no
   * usage has been fetched for this session yet.
   */
  contextUsage: ContextUsagePayload | null;
}

/** Dynamic command/skill catalog, broadcast when a live session reports `init`. */
export interface CommandsAvailablePayload {
  commands: CommandInfo[];
}

export interface ReplayDonePayload {
  lastSeq: number;
}

export interface TurnBeginPayload {
  userInput: string;
  /** Server-assigned stable id for the echoed user block. */
  id: string;
}

export interface TextDeltaPayload {
  /** Stable block id `${message.id}:${contentBlockIndex}`. */
  id: string;
  text: string;
  /**
   * When true, `text` is the FULL final content: the client SETS (replaces)
   * the block and stops streaming. Otherwise `text` is an incremental append.
   * The final commit repairs any prefix missed during a mid-stream reconnect.
   */
  final?: boolean;
}

export interface ThinkingDeltaPayload {
  /** Stable block id `${message.id}:${contentBlockIndex}`. */
  id: string;
  thinking: string;
  encrypted?: boolean;
  /** Full-content commit + stop streaming when true (see TextDeltaPayload.final). */
  final?: boolean;
}

export interface ToolCallPayload {
  /** SDK `tool_use.id` (`toolu_…`) — also the block id. */
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolCallDeltaPayload {
  id: string;
  argumentsPart: string;
}

export interface ToolResultPayload {
  toolCallId: string;
  output: unknown;
  isError: boolean;
  message?: string;
  displayBlocks?: unknown[];
}

export interface SubagentEventPayload {
  /** Parent Task `tool_use.id` this subagent activity nests under. */
  parentToolCallId: string;
  /** From `task_started` — surfaced on the subagent block header. */
  subagentType?: string;
  description?: string;
  /**
   * A nested delta event applied to the subagent's own block list. Uses the
   * same stable-id applicator as top-level events (text_delta/thinking_delta/
   * tool_call/tool_call_delta/tool_result/turn_end). `null` for header-only
   * frames (task_started/task_done) that just set subagentType/streaming.
   */
  inner: { type: WSMessageType; payload: unknown } | null;
}

export interface StatusUpdatePayload {
  tokenUsage: number;
  /** Cumulative session cost in USD, from the SDK `result` message. */
  totalCostUsd?: number;
}

/**
 * Trimmed projection of the SDK `getContextUsage()` control response. The rich
 * context-window breakdown is the single representation of context usage,
 * delivered on the `context_usage` event and cached as the session's snapshot
 * value. CLI theme `color` tokens are dropped; the client owns its palette.
 */
export interface ContextUsageCategory {
  name: string;
  tokens: number;
  /** True when the category is shown but not loaded into the prompt (deferred behind tool search). */
  isDeferred?: boolean;
}
export interface ContextUsageSkill {
  name: string;
  source: string;
  tokens: number;
}
export interface ContextUsageMemoryFile {
  path: string;
  type: string;
  tokens: number;
}
/** An MCP tool. `isLoaded === false` means it's deferred behind tool search. */
export interface ContextUsageMcpTool {
  name: string;
  serverName: string;
  tokens: number;
  isLoaded?: boolean;
}
/** A built-in tool deferred behind tool search; `isLoaded` reflects current state. */
export interface ContextUsageBuiltinTool {
  name: string;
  tokens: number;
  isLoaded: boolean;
}
/** A system-tools entry that is always part of the prompt. */
export interface ContextUsageSystemTool {
  name: string;
  tokens: number;
}
export interface ContextUsagePayload {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
  model: string;
  categories: ContextUsageCategory[];
  skills: ContextUsageSkill[];
  memoryFiles: ContextUsageMemoryFile[];
  mcpTools: ContextUsageMcpTool[];
  deferredBuiltinTools: ContextUsageBuiltinTool[];
  systemTools: ContextUsageSystemTool[];
}

export interface ApprovalRequestPayload {
  id: string;
  action: string;
  description: string;
  requestId: string;
  /**
   * Shell command this request runs, extracted from the SDK `display` shell
   * block when present. Used by the `auto` tier to decide whether a shell tool
   * is read-only and safe to auto-approve. Absent for non-shell tools.
   */
  command?: string;
}

export interface ApprovalResponsePayload {
  requestId: string;
  response: 'approve' | 'approve_for_session' | 'reject';
}

export interface QuestionRequestPayload {
  /** SDK `QuestionRequest.tool_call_id`. */
  id: string;
  /** SDK `QuestionRequest.id` — used to correlate `answer_question`. */
  requestId: string;
  questions: QuestionItemDTO[];
}

export type CompactionBeginPayload = Record<string, never>;
export type CompactionEndPayload = Record<string, never>;

/**
 * The turn's terminal status. Pump errors (thrown during iteration) surface
 * via the `error` event, not `turn_end`.
 */
export type TurnEndStatus = 'finished' | 'cancelled' | 'max_steps_reached';

export interface TurnEndPayload {
  status: TurnEndStatus;
  steps: number;
}

/**
 * Broadcast when a session is created so other connected clients refresh their
 * session list. Carries no body — the envelope's `sessionId` is the signal.
 */
export type SessionCreatedPayload = Record<string, never>;

/**
 * Broadcast when a session's persisted model/provider changes so connected
 * clients refresh their session list. Carries no body — the envelope's
 * `sessionId` is the signal.
 */
export type SessionUpdatedPayload = Record<string, never>;

export interface TitleUpdatePayload {
  title: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

// ─────────────────────────── Client → Server payloads ───────────────────────────

export interface SubscribePayload {
  sessionId: string;
  /** Last seq client has applied. Omitted on first connect. */
  lastSeq?: number;
}

export interface CreateSessionPayload {
  workDir: string;
  model?: string;
  /** Provider that owns `model`. Identity of a selection is (providerId, model). */
  providerId?: string;
  thinking?: boolean;
  approvalMode?: ApprovalMode;
  /** Initial reasoning effort; `null` or omitted is the provider default. */
  effort?: EffortLevel | null;
}

export interface ResumeSessionPayload {
  sessionId: string;
}

export interface SendMessagePayload {
  content: string;
  /**
   * Per-session agent flags to apply for this prompt onward. The composer's
   * Thinking/approval toggles are local UI state until the user sends; they
   * ride along here so a flag change costs no extra message and persists
   * exactly when it first takes effect. Omitted fields are left unchanged.
   */
  thinking?: boolean;
  approvalMode?: ApprovalMode;
  /** Model switch to apply for this turn onward; the server applies it via `Query.setModel`. */
  model?: string;
  /** Provider switch to apply alongside `model`; changes the subprocess env. */
  providerId?: string;
  /**
   * Reasoning effort to apply for this prompt onward. `null` resets to the
   * provider default; an omitted field leaves the current effort unchanged.
   */
  effort?: EffortLevel | null;
}

export type ApprovalResponse = 'approve' | 'approve_for_session' | 'reject';

export interface ApproveToolPayload {
  requestId: string;
  response: ApprovalResponse;
}

export interface AnswerQuestionPayload {
  requestId: string;
  answers: Record<string, string>;
  /** Optional per-question free-text notes, forwarded into AskUserQuestion's
   *  `updatedInput.annotations`. */
  annotations?: Record<string, { notes?: string }>;
}

export type InterruptTurnPayload = Record<string, never>;
export type CloseSessionPayload = Record<string, never>;

export interface AdoptProjectPayload {
  /** Logical project slug; must equal slugifyProjectName(name). */
  projectName: string;
}

export interface ProjectAdoptedPayload {
  projectName: string;
  workDir: string;
  sessionCount: number;
}

// ─────────────────────────── REST DTOs ───────────────────────────

export interface HealthResponse {
  ok: true;
  version: string;
}

// ─────────────────────────── Access control ───────────────────────────

/** `GET /api/me` — the current user's role and whether they may use the app. */
export interface MeResponse {
  role: 'admin' | 'user';
  /** `true` for everyone when access control is off; allowlist result when on. */
  allowed: boolean;
}

export interface AllowedEmailDTO {
  email: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface AllowlistResponse {
  emails: AllowedEmailDTO[];
}

/** `GET`/`PATCH /api/admin/access/control` — the allowlist gate's on/off state. */
export interface AccessControlResponse {
  /** Admin override; `null` means "follow the env default". */
  override: boolean | null;
  /** Effective value of the `ACCESS_CONTROL_ENABLED` env flag. */
  envDefault: boolean;
  /** Resolved gate state: `override ?? envDefault`. */
  effective: boolean;
}

export interface FileListResponse {
  entries: FileEntry[];
}

// Multipart upload field-order convention: clients MUST send the `path` field
// before the `file` part. The server streams the file straight to disk and
// rejects with 400 if the file part arrives without a known `path`.
export interface FileUploadResponse {
  written: string;
  size: number;
}

export interface FileWriteRequest {
  path: string;
  content: string;
}

export interface FileWriteResponse {
  written: string;
  size: number;
}

export interface SessionListResponse {
  sessions: SessionListItem[];
}

export interface ProjectSummary {
  name: string;
  workDir: string;
  /**
   * `local` when the workspace folder exists on the current machine.
   * `foreign` when only `sessions` rows reference this projectName.
   * Foreign projects become local on the first successful adoption
   * (which mkdir's the folder via `ensureWorkDir`).
   */
  origin: 'local' | 'foreign';
  /** `cloning` while a background `git clone` is still filling the folder
   *  (server consults the in-flight clone registry); otherwise ready. */
  status?: 'ready' | 'cloning';
}

/** Clone source for project creation. Token is supplied either by a saved
 *  per-user credential (`credentialId`) or inline (`inlineToken` + `provider`). */
export interface GitCloneSource {
  type: 'clone';
  url: string;
  credentialId?: string; // use a saved credential of the current user
  inlineToken?: string; // one-shot token (not persisted)
  provider?: GitProvider; // required when using inlineToken
}

export interface ProjectCreateRequest {
  name?: string; // required in blank mode; optional in clone mode (derived from repo)
  source?: { type: 'blank' } | GitCloneSource; // absent = blank
}

export type ProjectCreateResponse = ProjectSummary & {
  /** Clone runs asynchronously: the folder is already claimed, but objects are
   *  fetched in the background and progress is pushed over WS keyed by this id.
   *  Absent for blank projects, which are created synchronously. */
  cloneId?: string;
  /** `cloning` while a background clone runs; otherwise the project is ready. */
  status?: 'ready' | 'cloning';
};

/** Machine-readable clone failure code; mirrors the failing `CloneResult.kind`
 *  and the `clone_*` keys in the create error map. `clone_canceled` is the
 *  user-initiated abort — terminal but not an error (no toast). */
export type CloneErrorCode = 'clone_failed' | 'clone_timeout' | 'clone_canceled';

/** Pushed (user-scoped, not session-scoped) while a background `git clone`
 *  runs. `cloneId` matches the one returned by `POST /api/projects`. */
export interface CloneProgressPayload {
  cloneId: string;
  projectName: string;
  /** git phase label, e.g. "Receiving objects", "Resolving deltas". */
  phase: string;
  /** 0–100 within the current phase; null before git reports a percentage. */
  percent: number | null;
  status: 'cloning' | 'completed' | 'failed';
  /** Absolute workspace path; carried on every frame so a listener can build or
   *  register the sidebar row even when the originating modal has been closed
   *  (clone backgrounded). */
  workDir: string;
  /** Human-readable failure detail; set only when `status === 'failed'`. */
  error?: string;
  /** Machine code matching the create error map (`clone_failed` | `clone_timeout`). */
  errorCode?: CloneErrorCode;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
}

export interface ProjectDeleteResponse {
  ok: true;
  /** Number of `sessions` rows removed for the project. */
  sessionCount: number;
}

/** Cheap git snapshot of a project folder, shown in the delete dialog. */
export interface ProjectGitInfo {
  branch: string | null;
  /** Count of `git status --porcelain` entries (uncommitted changes). */
  dirtyCount: number;
  remote: string | null;
}

/** Lazy on-disk snapshot of a local project folder. `exists:false` for
 *  foreign (not-yet-adopted) projects, where delete is a DB-only operation. */
export interface ProjectStatResponse {
  exists: boolean;
  /** Top-level entry count (non-recursive). */
  entryCount: number;
  git: ProjectGitInfo | null;
}

export interface OverviewResponse {
  runtime: {
    startedAt: string;
    uptimeSec: number;
    nodeVersion: string;
    bunVersion: string;
  };
  db: {
    ok: boolean;
    latencyMs: number | null;
    error?: string;
  };
  ws: {
    clients: number;
    sessions: number;
  };
  access: {
    effective: boolean;
    envDefault: boolean;
    override: boolean | null;
    allowlistCount: number;
  };
}

// Re-export git-credential types so `shared/types` entrypoint covers everything.
export * from './types/git-credentials';
