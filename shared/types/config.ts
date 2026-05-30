// Claude provider auth mode (mutually exclusive, no fallback)
export const CLAUDE_PROVIDERS = ['oauth', 'api'] as const;
export type ClaudeProvider = (typeof CLAUDE_PROVIDERS)[number];

export function isClaudeProvider(v: unknown): v is ClaudeProvider {
  return typeof v === 'string' && (CLAUDE_PROVIDERS as readonly string[]).includes(v);
}

/** A single app setting. `value` is masked (e.g. "abcd***wxyz") when isSecret and not revealed; "" when unset. */
export interface ConfigSettingDTO {
  key: string;
  value: string;
  isSecret: boolean;
  isSet: boolean;
  updatedAt: string | null;
}

export interface ConfigResponse {
  settings: ConfigSettingDTO[];
}

/** PATCH body: only listed keys change. value === null → leave unchanged (keep existing secret). "" → clear. */
export interface ConfigPatchItem {
  key: string;
  value: string | null;
}
export interface ConfigPatchRequest {
  settings: ConfigPatchItem[];
}

/** POST /api/config/test — validate provider auth via a one-shot query(). */
export interface ConfigTestResponse {
  ok: boolean;
  error?: string;
}
