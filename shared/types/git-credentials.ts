// Git credential types — per-user PAT storage for HTTPS clone (GitHub / Azure
// DevOps). Server and client must agree on this surface verbatim. Tokens are
// never serialized in plaintext to the client; only `tokenMask` is sent.

export type GitProvider = 'github' | 'azure_devops';

export const GIT_PROVIDERS: readonly GitProvider[] = ['github', 'azure_devops'];

export function isGitProvider(value: unknown): value is GitProvider {
  return value === 'github' || value === 'azure_devops';
}

export interface GitCredentialDTO {
  id: string;
  label: string;
  provider: GitProvider;
  tokenMask: string; // ***<last4>
  createdAt: string;
  updatedAt: string;
}

export interface GitCredentialCreateRequest {
  label: string;
  provider: GitProvider;
  token: string;
}

export interface GitCredentialUpdateRequest {
  label?: string;
  provider?: GitProvider;
  token?: string;
}

export interface GitCredentialListResponse {
  credentials: GitCredentialDTO[];
}

export interface GitCredentialTestRequest {
  url: string;
  credentialId?: string;
  inlineToken?: string;
  provider?: GitProvider;
}

export interface GitCredentialTestResponse {
  ok: boolean;
  error?: string;
}
