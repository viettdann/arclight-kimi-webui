import type { UserPreferencesResponse, UserPreferencesUpdateRequest } from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/me/preferences';

/** Load the current user's global instructions (their `$HOME/.claude/CLAUDE.md`).
 *  `content` is `''` when nothing has been saved yet. */
export async function getUserPreferences(): Promise<UserPreferencesResponse> {
  const res = await authFetch(BASE);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Replace the current user's global instructions. */
export async function putUserPreferences(
  body: UserPreferencesUpdateRequest,
): Promise<UserPreferencesResponse> {
  const res = await authFetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
