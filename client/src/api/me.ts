import type { MeResponse } from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

export async function fetchMe(): Promise<MeResponse> {
  const res = await authFetch('/api/me');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
