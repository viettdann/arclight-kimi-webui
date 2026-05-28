import type { OverviewResponse } from 'shared/types';
import { authFetch, parseError } from '../lib/auth-fetch';

export async function fetchOverview(): Promise<OverviewResponse> {
  const res = await authFetch('/api/admin/overview');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
