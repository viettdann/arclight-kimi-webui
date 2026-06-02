import type {
  ProjectDiscoverySettingsResponse,
  ProjectDiscoverySettingsUpdateRequest,
} from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/me/project-discovery';

/** Load the current user's project discovery blacklist settings. */
export async function getProjectDiscoverySettings(): Promise<ProjectDiscoverySettingsResponse> {
  const res = await authFetch(BASE);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Update the current user's project discovery blacklist settings. */
export async function putProjectDiscoverySettings(
  body: ProjectDiscoverySettingsUpdateRequest,
): Promise<ProjectDiscoverySettingsResponse> {
  const res = await authFetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
