import type {
  KimiConfigDTO,
  KimiConfigPatchDTO,
  KimiConfigStatusResponse,
  KimiConfigTestResponse,
} from 'shared/types/kimi-config';
import { authFetch } from '../lib/auth-fetch';

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error && typeof body.error === 'string') return body.error;
    if (body?.message && typeof body.message === 'string') return body.message;
  } catch {
    // fallthrough
  }
  return `${res.status} ${res.statusText}`;
}

export async function fetchConfig(): Promise<KimiConfigDTO> {
  const res = await authFetch('/api/config');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function patchConfig(patch: KimiConfigPatchDTO): Promise<KimiConfigDTO> {
  const res = await authFetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchConfigStatus(): Promise<KimiConfigStatusResponse> {
  const res = await authFetch('/api/config/status');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function testConfigConnection(): Promise<KimiConfigTestResponse> {
  const res = await authFetch('/api/config/test', { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
