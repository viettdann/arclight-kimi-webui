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

/**
 * POST /api/config/test body. Optional override of the unsaved form edits the
 * user has not yet persisted. When present, it is merged over the saved config
 * and the probe runs against the result (→ `mode: 'draft'`). When absent, the
 * probe runs against the saved config (→ `mode: 'saved'`).
 *
 * Non-secret fields override whenever defined (an empty string means "cleared").
 * Secret fields override only when a plaintext string is sent; `null`/omitted
 * keeps the persisted secret — mirrors the PATCH contract.
 */
export interface ConfigTestRequest {
  provider?: ClaudeProvider;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string | null;
  ANTHROPIC_AUTH_TOKEN?: string | null;
}

/** POST /api/config/test — validate provider auth via a one-shot query(). */
export interface ConfigTestResponse {
  ok: boolean;
  error?: string;
  /** Which config the probe ran against: the unsaved draft, or the saved DB config. */
  mode?: 'draft' | 'saved';
  /** Provider the probe authenticated as. */
  provider?: ClaudeProvider;
}
