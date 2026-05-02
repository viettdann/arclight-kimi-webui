// Kimi config types — mirror the CLI config.toml structure.
// Server and client must agree on this surface verbatim.

export type ProviderType =
  | 'kimi'
  | 'openai_legacy'
  | 'openai_responses'
  | 'anthropic'
  | 'gemini'
  | 'vertexai';

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
  maxContextSize: number;
  capabilities: ModelCapability[];
  displayName?: string;
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

export type KimiConfigPatchDTO = Partial<
  Omit<KimiConfigDTO, 'updatedAt'> & {
    // apiKey=null means "leave unchanged" on PATCH
    provider?: Partial<ProviderBlock> & { apiKey?: string | null };
  }
>;

export interface KimiConfigStatusResponse {
  ready: boolean;
  authMode: 'api_key' | 'unconfigured';
  missing: string[];
}

export interface KimiConfigTestResponse {
  ok: boolean;
  error?: string;
}
