// Multi-provider shared contract. A provider is one credential/endpoint owning
// N models. Identity of a composer selection is `(providerId, modelId)`; the
// `namespace/displayName` tag is display-only.

export const PROVIDER_TYPES = ['oauth', 'api'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export function isProviderType(v: unknown): v is ProviderType {
  return typeof v === 'string' && (PROVIDER_TYPES as readonly string[]).includes(v);
}

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(v: unknown): v is Visibility {
  return typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v);
}

/** A provider is Built-in (global, admin-managed) or Personal (per-user). */
export type ProviderScope = 'builtin' | 'personal';

/** Fixed model set for an `oauth` provider — the SDK resolves these by id. */
export const OAUTH_MODELS: { id: string; displayName: string; contextWindow: number }[] = [
  { id: 'claude-opus-4-8', displayName: 'Opus 4.8', contextWindow: 200_000 },
  { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', contextWindow: 200_000 },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', contextWindow: 200_000 },
];

/** Default model selected for a freshly created `oauth` provider. */
export const OAUTH_DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Single source for title generation and the oauth connection ping. */
export const LIGHT_MODEL = 'claude-haiku-4-5-20251001';

/** Anthropic REST headers used by the model-list probe. */
export const ANTHROPIC_VERSION = '2023-06-01';
export const OAUTH_BETA = 'oauth-2025-04-20';

export interface ProviderModelDTO {
  id: string;
  modelId: string;
  displayName: string | null;
  contextWindow: number | null;
  isDefault: boolean;
}

export interface ProviderDTO {
  id: string;
  scope: ProviderScope;
  type: ProviderType;
  /** `public | private` for Built-in; null for Personal. */
  visibility: Visibility | null;
  namespace: string;
  baseUrl: string | null;
  /** `***<last4>` — the raw token is never serialized. */
  tokenMasked: string;
  models: ProviderModelDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface AvailableProvidersResponse {
  builtin: ProviderDTO[];
  personal: ProviderDTO[];
}

/** A model fetched from `/v1/models` or entered manually, used in test + save. */
export interface ProviderModelInput {
  modelId: string;
  displayName?: string | null;
  contextWindow?: number | null;
  isDefault?: boolean;
}

/** Draft credentials probed by the test endpoints (before save). */
export interface ProviderTestRequest {
  type: ProviderType;
  baseUrl?: string | null;
  /** Plaintext token. Omit/null on edit to reuse the saved secret. */
  token?: string | null;
  /** For `api`: the model to ping (else first fetched). Ignored for `oauth`. */
  model?: string | null;
  /** When editing, the provider whose saved token should back an omitted token. */
  providerId?: string | null;
}

export interface ProviderTestResponse {
  ok: boolean;
  error?: string;
  availableModels?: { id: string; displayName: string | null; contextWindow: number | null }[];
}

/** Create body. Admin (Built-in) forces type=api + sets visibility; Personal
 *  allows oauth|api and ignores visibility. The server enforces per-scope. */
export interface ProviderCreateRequest {
  type?: ProviderType;
  namespace: string;
  baseUrl?: string | null;
  token: string;
  visibility?: Visibility;
  models?: ProviderModelInput[];
}

export interface ProviderUpdateRequest {
  namespace?: string;
  baseUrl?: string | null;
  /** Omit/null to keep the saved secret. */
  token?: string | null;
  visibility?: Visibility;
  models?: ProviderModelInput[];
}

export interface ProvidersListResponse {
  providers: ProviderDTO[];
}
