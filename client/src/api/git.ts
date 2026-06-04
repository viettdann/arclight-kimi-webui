import type {
  GitBranchResponse,
  GitCommandRequest,
  GitCommandResponse,
  GitCommitRequest,
  GitLogResponse,
  GitStatusResponse,
} from 'shared/types/git-credentials';
import { GIT_ERROR_NOT_REPO } from 'shared/types/git-credentials';
import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/git';

export async function fetchGitStatus(projectName: string): Promise<GitStatusResponse> {
  const res = await authFetch(`${BASE}/status?projectName=${encodeURIComponent(projectName)}`);
  if (!res.ok) {
    const err = await parseError(res);
    // Surface "not a git repo" as a specific error so the UI can show empty state
    if (err === GIT_ERROR_NOT_REPO) {
      throw new NotGitRepoError();
    }
    throw new Error(err);
  }
  return res.json();
}

export async function fetchGitLog(projectName: string): Promise<GitLogResponse> {
  const res = await authFetch(`${BASE}/log?projectName=${encodeURIComponent(projectName)}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchGitDiff(
  projectName: string,
  opts?: { path?: string; staged?: boolean },
): Promise<GitCommandResponse> {
  const params = new URLSearchParams({ projectName });
  if (opts?.path) params.set('path', opts.path);
  if (opts?.staged) params.set('staged', 'true');

  const res = await authFetch(`${BASE}/diff?${params}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchGitBranches(projectName: string): Promise<GitBranchResponse> {
  const res = await authFetch(`${BASE}/branches?projectName=${encodeURIComponent(projectName)}`);
  if (!res.ok) {
    const err = await parseError(res);
    if (err === GIT_ERROR_NOT_REPO) {
      throw new NotGitRepoError();
    }
    throw new Error(err);
  }
  return res.json();
}

export async function executeGitCommand(body: GitCommandRequest): Promise<GitCommandResponse> {
  const res = await authFetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function commitGit(body: GitCommitRequest): Promise<GitCommandResponse> {
  const res = await authFetch(`${BASE}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export interface ProjectGitMetadata {
  userId: string;
  projectName: string;
  remoteUrl: string | null;
  provider: string | null;
  defaultBranch: string | null;
  credentialId: string | null;
}

export async function fetchProjectGitMetadata(
  projectName: string,
): Promise<ProjectGitMetadata | null> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(projectName)}/git-metadata`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(await parseError(res));
  }
  return res.json();
}

export async function linkGitCredential(
  projectName: string,
  credentialId: string | null,
): Promise<void> {
  const res = await authFetch(`/api/git/link-credential`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName, credentialId }),
  });
  if (!res.ok) throw new Error('Failed to link credential');
}

/** Thrown when the project directory is not a git repository. */
export class NotGitRepoError extends Error {
  constructor() {
    super(GIT_ERROR_NOT_REPO);
    this.name = 'NotGitRepoError';
  }
}
