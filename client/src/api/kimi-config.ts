import type {
  KimiConfigDTO,
  KimiConfigPatchDTO,
  KimiConfigRevealResponse,
  KimiConfigStatusResponse,
  KimiConfigTestRequest,
  KimiConfigTestResponse,
  KimiConfigTomlResponse,
} from 'shared/types/kimi-config';
import { authFetch, parseError } from '../lib/auth-fetch';

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

export async function testConfigConnection(
  payload: KimiConfigTestRequest = {},
): Promise<KimiConfigTestResponse> {
  const res = await authFetch('/api/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function revealApiKey(): Promise<KimiConfigRevealResponse> {
  const res = await authFetch('/api/config/reveal-api-key');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchConfigToml(): Promise<KimiConfigTomlResponse> {
  const res = await authFetch('/api/config/toml');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
