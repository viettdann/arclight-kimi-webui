import { authFetch, parseError } from '../lib/auth-fetch';

const BASE = '/api/config';

export interface UserSettingEntry {
  key: string;
  value: unknown;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await authFetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

async function apiPut(path: string, body: unknown): Promise<void> {
  const res = await authFetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

/** Get current user's settings */
export async function getMySettings(): Promise<Record<string, unknown>> {
  return apiGet('/my-settings');
}

/** Batch upsert user settings. value=null deletes the row. */
export async function putMySettings(settings: UserSettingEntry[]): Promise<void> {
  return apiPut('/my-settings', { settings });
}

/** Get resolved defaults (user → site → code) */
export async function getResolvedDefaults(): Promise<Record<string, unknown>> {
  return apiGet('/defaults');
}

/** Get site defaults only (admin) */
export async function getSiteDefaults(): Promise<Record<string, unknown>> {
  return apiGet('/defaults/site');
}

/** Get all site settings (admin) */
export async function getSiteSettings(): Promise<Record<string, unknown>> {
  return apiGet('/settings');
}

/** Batch upsert site settings (admin). value=null deletes the row. */
export async function putSiteSettings(settings: UserSettingEntry[]): Promise<void> {
  return apiPut('/settings', { settings });
}
