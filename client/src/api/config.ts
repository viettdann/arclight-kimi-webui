import type {
  ConfigPatchRequest,
  ConfigResponse,
  ConfigTestRequest,
  ConfigTestResponse,
} from 'shared/types/config';
import { authFetch, parseError } from '../lib/auth-fetch';

export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await authFetch('/api/config');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function patchConfig(body: ConfigPatchRequest): Promise<ConfigResponse> {
  const res = await authFetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function testConfig(body: ConfigTestRequest = {}): Promise<ConfigTestResponse> {
  const res = await authFetch('/api/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
