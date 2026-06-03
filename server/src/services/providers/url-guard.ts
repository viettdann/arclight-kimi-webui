import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Server-Side Request Forgery (SSRF) guard for provider base URLs. A saved
// token must never be redirected at an internal host: any caller-supplied base
// URL is parsed, scheme/userinfo checked, and every resolved address is matched
// against private / loopback / link-local / metadata ranges before we persist
// or probe it.

export type AssertSafeBaseUrlResult =
  | { ok: true; normalized: string }
  | { ok: false; error: 'invalid_base_url' };

const FAIL: AssertSafeBaseUrlResult = { ok: false, error: 'invalid_base_url' };

// ─────────────────────────── IPv4 classification ───────────────────────────

/** Parse a dotted-quad string into 4 octets, or null when not a valid IPv4. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Reject empty, non-numeric, or out-of-range octets (also rejects leading
    // signs / whitespace which Number() would otherwise tolerate).
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/** True for IPv4 ranges that must never be reachable from a saved token. */
function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;

  // 0.0.0.0/8 — "this network" / unspecified.
  if (a === 0) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 10.0.0.0/8 — RFC1918 private.
  if (a === 10) return true;
  // 172.16.0.0/12 — RFC1918 private.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC1918 private.
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local (covers the 169.254.169.254 metadata IP).
  if (a === 169 && b === 254) return true;

  return false;
}

// ─────────────────────────── IPv6 classification ───────────────────────────

/** Expand an IPv6 string to its 8 hextet groups, or null when malformed. */
function parseIpv6Groups(host: string): number[] | null {
  // Drop an IPv6 zone id (e.g. `fe80::1%eth0`) before parsing.
  const bare = host.split('%')[0] ?? host;

  // Split on `::` (the zero-run shorthand) which may appear at most once.
  const halves = bare.split('::');
  if (halves.length > 2) return null;

  const parseGroup = (g: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    return Number.parseInt(g, 16);
  };

  if (halves.length === 1) {
    const groups = bare.split(':');
    if (groups.length !== 8) return null;
    const out: number[] = [];
    for (const g of groups) {
      const n = parseGroup(g);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  }

  // `::` present — left and right of it, fill the gap with zero groups.
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const head: number[] = [];
  const tail: number[] = [];
  for (const g of left) {
    const n = parseGroup(g);
    if (n === null) return null;
    head.push(n);
  }
  for (const g of right) {
    const n = parseGroup(g);
    if (n === null) return null;
    tail.push(n);
  }
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/** True for IPv6 ranges that must never be reachable from a saved token. */
function isBlockedIpv6(groups: number[]): boolean {
  if (groups.length !== 8) return true; // treat unparseable as unsafe

  const first = groups[0] ?? 0;
  const last = groups[7] ?? 0;

  // ::1 — loopback.
  if (groups.slice(0, 7).every((g) => g === 0) && last === 1) return true;
  // :: — unspecified.
  if (groups.every((g) => g === 0)) return true;
  // fe80::/10 — link-local (top 10 bits == 1111111010).
  if ((first & 0xffc0) === 0xfe80) return true;
  // fc00::/7 — unique-local (top 7 bits == 1111110).
  if ((first & 0xfe00) === 0xfc00) return true;

  return false;
}

// ─────────────────────────── Address dispatch ───────────────────────────

/** Classify a resolved/literal IP string; unknown shapes are treated unsafe. */
function isBlockedAddress(addr: string): boolean {
  const kind = isIP(addr);
  if (kind === 4) {
    const octets = parseIpv4(addr);
    return octets === null ? true : isBlockedIpv4(octets);
  }
  if (kind === 6) {
    // node may return IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — check the
    // embedded IPv4 too.
    const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (mapped?.[1]) {
      const octets = parseIpv4(mapped[1]);
      if (octets && isBlockedIpv4(octets)) return true;
    }
    const groups = parseIpv6Groups(addr);
    return groups === null ? true : isBlockedIpv6(groups);
  }
  return true; // not a recognizable IP literal → unsafe
}

// ─────────────────────────── Public API ───────────────────────────

/**
 * Validate a caller-supplied base URL against SSRF. Resolves to a normalized
 * `origin + path` on success so the host we validated is exactly the host we
 * fetch. The path is preserved (SSRF only concerns the host/IP) so path-based
 * providers like `https://host/api/coding` are not silently truncated; query
 * and hash are dropped and any trailing slash is trimmed to avoid `//v1`.
 */
export async function assertSafeBaseUrl(raw: string): Promise<AssertSafeBaseUrlResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return FAIL;
  }

  // Only plain HTTP(S) endpoints are allowed.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return FAIL;
  // No `user:pass@` — credentials in the URL are a redirect / smuggling vector.
  if (url.username !== '' || url.password !== '') return FAIL;

  const host = url.hostname;
  if (host === '') return FAIL;

  // Preserve the path (e.g. `/api/coding`); strip trailing slash, query, hash.
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;

  // Strip bracket notation that `URL` keeps for IPv6 literals (`[::1]`).
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // If the host is already an IP literal, classify it directly — no DNS needed.
  const literalKind = isIP(bareHost);
  if (literalKind !== 0) {
    return isBlockedAddress(bareHost) ? FAIL : { ok: true, normalized };
  }

  // Otherwise resolve the hostname and reject if ANY returned address is unsafe.
  try {
    const records = await lookup(bareHost, { all: true });
    if (records.length === 0) return FAIL;
    for (const { address } of records) {
      if (isBlockedAddress(address)) return FAIL;
    }
  } catch {
    return FAIL;
  }

  return { ok: true, normalized };
}
