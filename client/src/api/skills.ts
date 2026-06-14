import type { SkillDTO, SkillListResponse, SkillUploadResponse } from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/me/skills';

/** List the current user's skills, ordered by name. */
export async function listSkills(): Promise<SkillDTO[]> {
  const res = await authFetch(BASE);
  if (!res.ok) throw new Error(await parseError(res));
  const body: SkillListResponse = await res.json();
  return body.skills;
}

/** Upload skills as multipart form-data. Per-skill errors are returned in the
 *  response body, not thrown. Content-Type is intentionally unset so the
 *  browser appends the multipart boundary. */
export async function uploadSkills(form: FormData): Promise<SkillUploadResponse> {
  const res = await authFetch(`${BASE}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Enable or disable a skill. */
export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await authFetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

/** Permanently delete a skill. */
export async function deleteSkill(id: string): Promise<void> {
  const res = await authFetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res));
}
