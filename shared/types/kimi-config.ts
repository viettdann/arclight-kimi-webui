// Kimi config types — mirror the CLI config.toml structure.
// Server and client must agree on this surface verbatim.

export const PROVIDER_TYPES = ['kimi', 'openai_legacy', 'openai_responses', 'anthropic'] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export function isProviderType(t: string): t is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(t);
}

export type ModelCapability = 'thinking' | 'always_thinking' | 'image_in' | 'video_in';

export interface DefaultsBlock {
  model: string;
  thinking: boolean;
  yolo: boolean;
  planMode: boolean;
  editor: string;
  theme: 'dark' | 'light';
  showThinkingStream: boolean;
  skipAfkPromptInjection: boolean;
  mergeAllAvailableSkills: boolean;
  extraSkillDirs: string[];
  telemetry: boolean;
}

export interface ProviderBlock {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  env: Record<string, string>;
  customHeaders: Record<string, string>;
}

export interface ModelEntry {
  provider: string;
  model: string;
  /** Model's total context window (prompt + completion). */
  maxContextSize: number;
  capabilities: ModelCapability[];
  displayName?: string;
  /** Sampling temperature. */
  temperature?: number;
  /** Nucleus sampling cutoff. */
  topP?: number;
  /** Per-response generation cap (output tokens only — distinct from `maxContextSize`). */
  maxTokens?: number;
}

export interface ServiceEntry {
  baseUrl: string;
  apiKey: string;
  customHeaders?: Record<string, string>;
}

export interface ServicesBlock {
  search: ServiceEntry | null;
  fetch: ServiceEntry | null;
}

export interface LoopControlBlock {
  maxStepsPerTurn: number;
  maxRetriesPerStep: number;
  maxRalphIterations: number;
  reservedContextSize: number;
  compactionTriggerRatio: number;
}

export interface BackgroundBlock {
  maxRunningTasks: number;
  readMaxBytes: number;
  notificationTailLines: number;
  notificationTailChars: number;
  waitPollIntervalMs: number;
  workerHeartbeatIntervalMs: number;
  workerStaleAfterMs: number;
  killGracePeriodMs: number;
  keepAliveOnExit: boolean;
  agentTaskTimeoutS: number;
  printWaitCeilingS: number;
}

export interface NotificationsBlock {
  claimStaleAfterMs: number;
}

export interface McpClientBlock {
  toolCallTimeoutMs: number;
}

export interface HookEntry {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}

export interface KimiConfigRow {
  id: number;
  defaults: DefaultsBlock;
  provider: ProviderBlock;
  models: Record<string, ModelEntry>;
  services: ServicesBlock;
  loopControl: LoopControlBlock;
  background: BackgroundBlock;
  notifications: NotificationsBlock;
  mcpClient: McpClientBlock;
  hooks: HookEntry[];
  extraTomlOverride: string;
  updatedAt: string;
}

// ─────────────────────────── REST DTOs ───────────────────────────

export interface KimiConfigDTO {
  defaults: DefaultsBlock;
  provider: ProviderBlock;
  models: Record<string, ModelEntry>;
  services: ServicesBlock;
  loopControl: LoopControlBlock;
  background: BackgroundBlock;
  notifications: NotificationsBlock;
  mcpClient: McpClientBlock;
  hooks: HookEntry[];
  extraTomlOverride: string;
  updatedAt: string;
}

// apiKey=null on provider means "leave unchanged" on PATCH.
export type KimiConfigPatchDTO = {
  defaults?: DefaultsBlock;
  provider?: Omit<Partial<ProviderBlock>, 'apiKey'> & { apiKey?: string | null };
  models?: Record<string, ModelEntry>;
  services?: ServicesBlock;
  loopControl?: LoopControlBlock;
  background?: BackgroundBlock;
  notifications?: NotificationsBlock;
  mcpClient?: McpClientBlock;
  hooks?: HookEntry[];
  extraTomlOverride?: string;
};

export interface KimiConfigStatusResponse {
  ready: boolean;
  authMode: 'api_key' | 'unconfigured';
  missing: string[];
  system?: {
    workspaceRoot: string;
    maxUploadBytes: number;
    nodeEnv: string;
    logLevel: string;
    port: number;
  };
}

export interface KimiConfigTestResponse {
  ok: boolean;
  error?: string;
}

// Body for POST /api/config/test. Optional provider overrides let the client
// test in-memory edits without saving first; apiKey === null (or omitted)
// means "use the stored key".
export type KimiConfigTestRequest = {
  provider?: Omit<Partial<ProviderBlock>, 'apiKey'> & { apiKey?: string | null };
};

export interface KimiConfigRevealResponse {
  apiKey: string;
}

export interface KimiConfigTomlResponse {
  /** Empty string when the file does not exist or cannot be read. */
  content: string;
  exists: boolean;
  /** Absolute on-disk path the server checked. */
  path: string;
}
