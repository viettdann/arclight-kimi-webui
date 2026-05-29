export class CloneUrlError extends Error {
  readonly code: 'invalid_url' | 'unsupported_scheme';
  constructor(code: 'invalid_url' | 'unsupported_scheme') {
    super(code);
    this.name = 'CloneUrlError';
    this.code = code;
  }
}

// Parse a user-supplied clone URL. Accepts a bare `host/path` (assumes https)
// or a full http(s) URL. Rejects anything that is not http/https.
export function parseCloneUrl(raw: string): URL {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      throw new CloneUrlError('invalid_url');
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CloneUrlError('unsupported_scheme');
  }
  return url;
}

// Derive a repo name from the last non-empty path segment, stripping `.git`.
// Returns the RAW segment (callers slugify). null when no usable segment.
export function deriveRepoName(url: string): string | null {
  let parsed: URL;
  try {
    parsed = parseCloneUrl(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  let last = segments[segments.length - 1] ?? '';
  if (last.endsWith('.git')) last = last.slice(0, -'.git'.length);
  if (last.length === 0) return null;
  return last;
}
