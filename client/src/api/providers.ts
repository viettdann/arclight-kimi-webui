import type {
  AvailableProvidersResponse,
  ProviderCreateRequest,
  ProviderDTO,
  ProviderModelsResponse,
  ProvidersListResponse,
  ProviderTestRequest,
  ProviderTestResponse,
  ProviderUpdateRequest,
} from 'shared/types/providers';
import { authFetch, parseError } from '../lib/auth-fetch';

// ── Admin / Built-in ────────────────────────────────────────────────────────

const ADMIN_BASE = '/api/config/providers/builtin';

export async function listBuiltinProviders(): Promise<ProvidersListResponse> {
  const res = await authFetch(ADMIN_BASE);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createBuiltinProvider(body: ProviderCreateRequest): Promise<ProviderDTO> {
  const res = await authFetch(ADMIN_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function updateBuiltinProvider(
  id: string,
  body: ProviderUpdateRequest,
): Promise<ProviderDTO> {
  const res = await authFetch(`${ADMIN_BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteBuiltinProvider(id: string): Promise<void> {
  const res = await authFetch(`${ADMIN_BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function testBuiltinProvider(
  body: ProviderTestRequest,
): Promise<ProviderTestResponse> {
  const res = await authFetch(`${ADMIN_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchBuiltinProviderModels(
  body: ProviderTestRequest,
): Promise<ProviderModelsResponse> {
  const res = await authFetch(`${ADMIN_BASE}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// ── Personal (me) ───────────────────────────────────────────────────────────

const ME_BASE = '/api/config/providers';

export async function listMyProviders(): Promise<ProvidersListResponse> {
  const res = await authFetch(ME_BASE);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createMyProvider(body: ProviderCreateRequest): Promise<ProviderDTO> {
  const res = await authFetch(ME_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function updateMyProvider(
  id: string,
  body: ProviderUpdateRequest,
): Promise<ProviderDTO> {
  const res = await authFetch(`${ME_BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteMyProvider(id: string): Promise<void> {
  const res = await authFetch(`${ME_BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function testMyProvider(body: ProviderTestRequest): Promise<ProviderTestResponse> {
  const res = await authFetch(`${ME_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchMyProviderModels(
  body: ProviderTestRequest,
): Promise<ProviderModelsResponse> {
  const res = await authFetch(`${ME_BASE}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// ── Available catalog ───────────────────────────────────────────────────────

export async function fetchAvailableProviders(): Promise<AvailableProvidersResponse> {
  const res = await authFetch('/api/config/providers/available');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
