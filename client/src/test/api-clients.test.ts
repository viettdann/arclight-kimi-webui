import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listGitCredentials,
  createGitCredential,
  deleteGitCredential,
} from '@/api/git-credentials';
import { fetchAvailableProviders } from '@/api/providers';
import { setAccessControl } from '@/api/access';

// The api/* layer is thin wrappers over authFetch + parseError; exercise the
// real wrappers against a mocked fetch so URL/method/body construction and the
// ok→json / non-ok→throw contract are all covered in one pass.
const fetchMock = vi.fn();

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api wrappers — success paths', () => {
  it('listGitCredentials GETs the collection and returns parsed JSON', async () => {
    fetchMock.mockResolvedValue(jsonRes({ credentials: [{ id: 'g1' }] }));
    const out = await listGitCredentials();

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/config/general/git-credentials');
    expect(fetchMock.mock.calls[0]![1].method).toBeUndefined(); // default GET
    expect(out).toEqual({ credentials: [{ id: 'g1' }] });
  });

  it('createGitCredential POSTs the serialized body', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 'g2' }));
    const out = await createGitCredential({ name: 'gh' } as never);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/config/general/git-credentials');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'gh' });
    expect(out).toEqual({ id: 'g2' });
  });

  it('deleteGitCredential DELETEs and resolves void on ok', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 204 }));
    await expect(deleteGitCredential('g1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/config/general/git-credentials/g1');
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
  });

  it('fetchAvailableProviders hits the available catalog', async () => {
    fetchMock.mockResolvedValue(jsonRes({ builtin: [], personal: [] }));
    const out = await fetchAvailableProviders();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/config/providers/available');
    expect(out).toEqual({ builtin: [], personal: [] });
  });

  it('setAccessControl PATCHes the override payload', async () => {
    fetchMock.mockResolvedValue(jsonRes({ effective: true }));
    await setAccessControl(false);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/config/system/control');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ override: false });
  });
});

describe('api wrappers — error paths', () => {
  it('throws the JSON error field on a non-ok response', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'forbidden' }, 403));
    await expect(listGitCredentials()).rejects.toThrow('forbidden');
  });

  it('throws the status line when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));
    await expect(fetchAvailableProviders()).rejects.toThrow('500 Server Error');
  });
});
