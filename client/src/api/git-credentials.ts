import type {
  GitCredentialCreateRequest,
  GitCredentialDTO,
  GitCredentialListResponse,
  GitCredentialTestRequest,
  GitCredentialTestResponse,
  GitCredentialUpdateRequest,
} from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/config/general/git-credentials';

export async function listGitCredentials(): Promise<GitCredentialListResponse> {
  const res = await authFetch(BASE);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createGitCredential(
  body: GitCredentialCreateRequest,
): Promise<GitCredentialDTO> {
  const res = await authFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function updateGitCredential(
  id: string,
  body: GitCredentialUpdateRequest,
): Promise<GitCredentialDTO> {
  const res = await authFetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteGitCredential(id: string): Promise<void> {
  const res = await authFetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function testGitCredential(
  body: GitCredentialTestRequest,
): Promise<GitCredentialTestResponse> {
  const res = await authFetch(`${BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
