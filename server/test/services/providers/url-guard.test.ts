import { afterEach, describe, expect, it, mock } from 'bun:test';

// ─────────────────────────── DNS mock ───────────────────────────
//
// Declare before dynamic import so mock.module registers first. Each test sets
// `lookupResult` to the addresses a hostname should resolve to (or throws when
// `lookupThrows` is set, simulating a resolution failure).

let lookupResult: { address: string; family: number }[] = [];
let lookupThrows = false;

mock.module('node:dns/promises', () => ({
  lookup: async (_host: string, _opts: { all: boolean }) => {
    if (lookupThrows) throw new Error('ENOTFOUND');
    return lookupResult;
  },
}));

// ─────────────────────────── Module under test ───────────────────────────

const { assertSafeBaseUrl } = await import('../../../src/services/providers/url-guard');

afterEach(() => {
  lookupResult = [];
  lookupThrows = false;
});

describe('assertSafeBaseUrl', () => {
  it('accepts a public https URL and returns the normalized origin', async () => {
    lookupResult = [{ address: '93.184.216.34', family: 4 }];
    const r = await assertSafeBaseUrl('https://api.example.com/v1/');
    expect(r).toEqual({ ok: true, normalized: 'https://api.example.com' });
  });

  it('allows http scheme', async () => {
    lookupResult = [{ address: '93.184.216.34', family: 4 }];
    const r = await assertSafeBaseUrl('http://api.example.com');
    expect(r).toEqual({ ok: true, normalized: 'http://api.example.com' });
  });

  it('rejects URLs that carry userinfo', async () => {
    lookupResult = [{ address: '93.184.216.34', family: 4 }];
    const r = await assertSafeBaseUrl('https://user:pass@api.example.com');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects a non-http(s) scheme', async () => {
    const r = await assertSafeBaseUrl('ftp://api.example.com');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects literal loopback 127.0.0.1', async () => {
    const r = await assertSafeBaseUrl('http://127.0.0.1:8080');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects literal RFC1918 10.x', async () => {
    const r = await assertSafeBaseUrl('http://10.0.0.5');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects literal RFC1918 192.168.x', async () => {
    const r = await assertSafeBaseUrl('https://192.168.1.1');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects the cloud metadata IP 169.254.169.254', async () => {
    const r = await assertSafeBaseUrl('http://169.254.169.254/latest/meta-data');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects the IPv6 loopback ::1', async () => {
    const r = await assertSafeBaseUrl('http://[::1]:9000');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects a public hostname that resolves to a private IP', async () => {
    // DNS-rebinding style: hostname looks public but resolves internal.
    lookupResult = [{ address: '10.1.2.3', family: 4 }];
    const r = await assertSafeBaseUrl('https://evil.example.com');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects when any resolved address is private (mixed records)', async () => {
    lookupResult = [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ];
    const r = await assertSafeBaseUrl('https://mixed.example.com');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects when DNS resolution fails', async () => {
    lookupThrows = true;
    const r = await assertSafeBaseUrl('https://nxdomain.example.com');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects when DNS returns no records', async () => {
    lookupResult = [];
    const r = await assertSafeBaseUrl('https://empty.example.com');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });

  it('rejects a malformed URL', async () => {
    const r = await assertSafeBaseUrl('not a url');
    expect(r).toEqual({ ok: false, error: 'invalid_base_url' });
  });
});
