// Kimi WebUI shared contract — copied from design doc.
// Server and client must agree on this surface verbatim.

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
  | 'step_begin'
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
  | 'step_interrupted'
  | 'parse_error'
  | 'compaction_begin'
  | 'compaction_end'
  | 'steer_input'
  | 'turn_end'
  | 'session_state'
  | 'title_update'
  | 'project_adopted'
  | 'error'
  // client → server
  | 'subscribe'
  | 'create_session'
  | 'resume_session'
  | 'send_message'
  | 'approve_tool'
  | 'answer_question'
  | 'interrupt_turn'
  | 'close_session'
  | 'adopt_project';

// ─────────────────────────── Domain types ───────────────────────────

export type SessionStatus = 'active' | 'idle' | 'closed';

export type DisplayBlock =
  | { type: 'shell'; command: string; language: string }
  | { type: 'diff'; path: string; oldText: string; newText: string }
  | { type: 'todo'; items: { title: string; status: 'pending' | 'in_progress' | 'done' }[] }
  | { type: 'brief'; text: string }
  | { type: 'unknown'; rawType: string; raw: Record<string, unknown> };

export type Block =
  | { kind: 'user'; id: string; content: string; createdAt: string; status?: 'pending' | 'sent' }
  | {
      kind: 'text';
      id: string;
      turnIdx: number;
      stepIdx: number;
      partIdx: number;
      content: string;
      isStreaming: boolean;
      createdAt: string;
    }
  | {
      kind: 'thinking';
      id: string;
      turnIdx: number;
      stepIdx: number;
      partIdx: number;
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
      kind: 'subagent';
      id: string;
      parentToolCallId: string;
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
  | { kind: 'steer'; id: string; content: string; createdAt: string }
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
  model: string | null;
  thinking: boolean;
  status: SessionStatus;
  totalTokens: number;
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
}

export interface QuestionItemDTO {
  question: string;
  header?: string;
  options: QuestionOptionDTO[];
  /** Normalized from SDK snake_case `multi_select`. */
  multiSelect?: boolean;
}

// ─────────────────────────── Server → Client payloads ───────────────────────────

export interface SnapshotPayload {
  blocks: Block[];
  status: SessionStatus;
  totalTokens: number;
  title: string | null;
  pendingPrompt: { text: string; enqueuedAt: string } | null;
  live: {
    /** True iff the server still has an in-flight Turn for this session. */
    turnInProgress: boolean;
    turnIdx: number | null;
    stepIdx: number | null;
    /** Current part index of the in-flight thinking section (per turn+step). */
    thinkPartIdx: number;
    /** Current part index of the in-flight text section (per turn+step). */
    textPartIdx: number;
  };
}

export interface ReplayDonePayload {
  lastSeq: number;
}

export interface TurnBeginPayload {
  userInput: string;
}

export interface StepBeginPayload {
  stepNumber: number;
}

export interface TextDeltaPayload {
  text: string;
  /** Disambiguates multiple text segments within the same (turnIdx, stepIdx). */
  partIdx: number;
}

export interface ThinkingDeltaPayload {
  thinking: string;
  encrypted?: boolean;
  /** Disambiguates multiple thinking segments within the same (turnIdx, stepIdx). */
  partIdx: number;
}

export interface ToolCallPayload {
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
  parentToolCallId: string;
  event: unknown;
}

export interface StatusUpdatePayload {
  tokenUsage: number;
  contextUsage: number;
}

export interface ApprovalRequestPayload {
  id: string;
  action: string;
  description: string;
  requestId: string;
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

export type StepInterruptedPayload = Record<string, never>;
export type CompactionBeginPayload = Record<string, never>;
export type CompactionEndPayload = Record<string, never>;

/**
 * Carries either a SDK `WireEvent` ParseError (envelope decode of one wire
 * frame failed — `rawType` set) or a top-level `StreamEvent` ParseError
 * (raw frame text — `raw` set). Both surface to the client as `parse_error`.
 */
export interface ParseErrorPayload {
  code: string;
  message: string;
  rawType?: string;
  raw?: string;
}

/** Echo of a steer-input from any user — broadcast back to all attached sockets. */
export interface SteerInputPayload {
  content: string;
}

// Mirrors `RunResult.status` from `@moonshot-ai/kimi-agent-sdk`. Pump errors
// (thrown during iteration) surface via the `error` event, not `turn_end`.
export type TurnEndStatus = 'finished' | 'cancelled' | 'max_steps_reached';

export interface TurnEndPayload {
  status: TurnEndStatus;
  steps: number;
}

/** Origin of a `session_state` transition. Set when `state === 'closed'`. */
export type SessionStateReason = 'ws' | 'rest' | 'system';

export interface SessionStatePayload {
  state: SessionStatus;
  /** Origin of close. Present iff state === 'closed'. */
  reason?: SessionStateReason;
}

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
  thinking?: boolean;
  yoloMode?: boolean;
}

export interface ResumeSessionPayload {
  sessionId: string;
}

export interface SendMessagePayload {
  content: string;
}

// Mirrors `ApprovalResponse` from `@moonshot-ai/kimi-agent-sdk`.
export type ApprovalResponse = 'approve' | 'approve_for_session' | 'reject';

export interface ApproveToolPayload {
  requestId: string;
  response: ApprovalResponse;
}

export interface AnswerQuestionPayload {
  requestId: string;
  answers: Record<string, string>;
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

export interface SessionListResponse {
  sessions: SessionListItem[];
}

export interface ProjectSummary {
  name: string;
  workDir: string;
  /**
   * `local` when the workspace folder exists on the current machine.
   * `foreign` when only `kimi_sessions` rows reference this projectName.
   * Foreign projects become local on the first successful adoption
   * (which mkdir's the folder via `ensureWorkDir`).
   */
  origin: 'local' | 'foreign';
}

export interface ProjectCreateRequest {
  name: string;
}

export type ProjectCreateResponse = ProjectSummary;

export interface ProjectListResponse {
  projects: ProjectSummary[];
}

// Re-export kimi-config types so `shared/types` entrypoint covers everything.
export * from './types/kimi-config';
