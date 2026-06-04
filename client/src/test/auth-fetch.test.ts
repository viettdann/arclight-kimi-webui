import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch, parseError } from '@/lib/auth-fetch';

// authFetch surfaces 401s through the auth store; stub it so we can assert the
// clearSession side effect without pulling in the real store/ws-client cycle.
const { clearSession } = vi.hoisted(() => ({ clearSession: vi.fn() }));
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: { getState: () => ({ clearSession }) },
}));

const fetchMock = vi.fn();

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  clearSession.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authFetch', () => {
  it('forces credentials:include and a default Accept header', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await authFetch('/api/x');

    const [input, init] = fetchMock.mock.calls[0]!;
    expect(input).toBe('/api/x');
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('merges caller headers, keeping the default Accept', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await authFetch('/api/x', { headers: { 'Content-Type': 'application/json' } });

    const init = fetchMock.mock.calls[0]![1];
    const headers = init.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('does not override a caller-supplied Accept', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await authFetch('/api/x', { headers: { Accept: 'text/plain' } });

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get('Accept')).toBe('text/plain');
  });

  it('clears the session on a 401', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    await authFetch('/api/x');
    expect(clearSession).toHaveBeenCalledWith('rest-401');
  });

  it('skips the 401 handler when skipAuthHandling is set', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const res = await authFetch('/api/x', { skipAuthHandling: true });
    expect(res.status).toBe(401);
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('collapses parallel 401s into a single clearSession (single-flight)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    await Promise.all([authFetch('/api/a'), authFetch('/api/b'), authFetch('/api/c')]);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('returns the response untouched on success', async () => {
    fetchMock.mockResolvedValue(ok({ hello: 'world' }));
    const res = await authFetch('/api/x');
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ hello: 'world' });
  });
});

describe('parseError', () => {
  it('prefers the JSON error field', async () => {
    const res = new Response(JSON.stringify({ error: 'invalid_name' }), { status: 400 });
    expect(await parseError(res)).toBe('invalid_name');
  });

  it('falls back to the JSON message field', async () => {
    const res = new Response(JSON.stringify({ message: 'boom' }), { status: 400 });
    expect(await parseError(res)).toBe('boom');
  });

  it('falls back to the status line for a non-JSON body', async () => {
    const res = new Response('<html>500</html>', { status: 500, statusText: 'Server Error' });
    expect(await parseError(res)).toBe('500 Server Error');
  });
});
