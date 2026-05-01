import { useAuthStore } from './auth-store';

export type AuthFetchInit = RequestInit & { skipAuthHandling?: boolean };

// Single-flight guard so 5 parallel 401s collapse into one `clearSession`.
let inflight: Promise<void> | null = null;

function handleUnauthorized(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    useAuthStore.getState().clearSession('rest-401');
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Single typed entrypoint for every protected REST call. On 401, terminates
 * the auth session client-side; never retries; never swallows network errors.
 *
 * - `credentials: 'include'` is forced so the auth cookie is always sent.
 * - `Accept: application/json` is set unless the caller overrides it.
 * - `skipAuthHandling: true` bypasses the 401 → clearSession path (for the
 *   rare caller that wants to inspect a 401 directly, e.g. probing endpoints).
 */
const DEFAULT_HEADERS: HeadersInit = { Accept: 'application/json' };

export async function authFetch(input: RequestInfo | URL, init?: AuthFetchInit): Promise<Response> {
  const { skipAuthHandling, headers, ...rest } = init ?? {};

  // Common path: caller passed no headers — reuse the literal and skip the
  // Headers allocation. Only build a Headers wrapper when we need to merge
  // caller-provided values with the default Accept.
  let nextHeaders: HeadersInit;
  if (!headers) {
    nextHeaders = DEFAULT_HEADERS;
  } else {
    const merged = new Headers(headers);
    if (!merged.has('Accept')) merged.set('Accept', 'application/json');
    nextHeaders = merged;
  }

  const res = await fetch(input, {
    ...rest,
    credentials: 'include',
    headers: nextHeaders,
  });

  if (res.status === 401 && !skipAuthHandling) {
    await handleUnauthorized();
  }
  return res;
}
