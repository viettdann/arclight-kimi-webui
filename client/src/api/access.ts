import type { AccessControlResponse, AllowedEmailDTO, AllowlistResponse } from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/config/system';

export async function listAllowlist(): Promise<AllowlistResponse> {
  const res = await authFetch(`${BASE}/allowlist`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function addAllowedEmail(email: string): Promise<AllowedEmailDTO> {
  const res = await authFetch(`${BASE}/allowlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function removeAllowedEmail(email: string): Promise<void> {
  const res = await authFetch(`${BASE}/allowlist/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function fetchAccessControl(): Promise<AccessControlResponse> {
  const res = await authFetch(`${BASE}/control`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function setAccessControl(override: boolean | null): Promise<AccessControlResponse> {
  const res = await authFetch(`${BASE}/control`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ override }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
