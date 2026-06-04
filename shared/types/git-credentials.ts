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

/** Shared error code for "not a git repository" responses. */
export const GIT_ERROR_NOT_REPO = 'not_a_git_repo' as const;

// ─────────────────────────── Git panel types ───────────────────────────

export type GitSubcommand =
  | 'status'
  | 'log'
  | 'diff'
  | 'add'
  | 'commit'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'branch'
  | 'checkout'
  | 'stash';

export interface GitCommandRequest {
  projectName: string;
  command: GitSubcommand;
  args?: string[];
  /** Use a saved credential for remote auth. */
  credentialId?: string;
  /** One-shot token (not persisted). */
  inlineToken?: string;
  /** Required when using inlineToken. */
  provider?: GitProvider;
}

export interface GitCommandResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when the failure was an auth failure — client should prompt for PAT. */
  requiresAuth?: boolean;
  /**
   * True when a credential WAS applied but the remote rejected with a
   * permission error (e.g. PAT lacks write scope for push). Re-picking the
   * same credential won't help; one with more scope might.
   */
  permissionDenied?: boolean;
}

export interface GitCommitRequest {
  projectName: string;
  /** Paths relative to the project root, as reported by GitStatusEntry.path. */
  files: string[];
  message: string;
}

export interface GitStatusEntry {
  /** porcelain v2 XY codes, e.g. '1 .M', '1 M.', '? '. */
  statusCode: string;
  path: string;
  /** Original path for rename/copy entries (porcelain v2 `2` lines). */
  origPath?: string;
}

export interface GitStatusResponse {
  branch: string | null;
  entries: GitStatusEntry[];
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitLogResponse {
  entries: GitLogEntry[];
  currentBranch: string | null;
}

export interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitBranchResponse {
  branches: GitBranchEntry[];
  currentBranch: string | null;
}
