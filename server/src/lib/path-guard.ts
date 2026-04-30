import { realpath } from 'node:fs/promises';
import path from 'node:path';

// Path-guard: keep every filesystem op inside a user's workspace root.
// Rules per design §"Auth & Isolation":
//   1. Reject NUL byte (\0) in relPath
//   2. Reject leading '/' (absolute)
//   3. resolve(userRoot, relPath) must remain within userRoot
//   4. If the target exists, realpath() must also stay within userRoot
//      (defends against symlink escape).
//
// Throws Error with code-like message; caller is responsible for mapping to
// HTTP 403.

function isInside(parentAbs: string, childAbs: string): boolean {
  const rel = path.relative(parentAbs, childAbs);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

export async function resolveUserPath(userRoot: string, relPath: string): Promise<string> {
  if (typeof relPath !== 'string') {
    throw new Error('path-guard: relPath must be a string');
  }
  if (relPath.includes('\0')) {
    throw new Error('path-guard: null byte in relPath');
  }
  if (relPath.startsWith('/')) {
    throw new Error('path-guard: absolute path rejected');
  }

  const rootAbs = path.resolve(userRoot);
  const abs = path.resolve(rootAbs, relPath);
  if (!isInside(rootAbs, abs)) {
    throw new Error('path-guard: path escapes user root');
  }

  // If either the target or the root resolves through a symlink, re-check the
  // realpath stays inside the realpath of the root.
  let realRoot: string;
  try {
    realRoot = await realpath(rootAbs);
  } catch {
    realRoot = rootAbs;
  }

  let realAbs: string | null = null;
  try {
    realAbs = await realpath(abs);
  } catch {
    // Target doesn't exist yet (e.g. upload). That's fine — the resolved abs
    // already passed the lexical containment check.
    realAbs = null;
  }

  if (realAbs !== null && !isInside(realRoot, realAbs)) {
    throw new Error('path-guard: realpath escapes user root');
  }

  return abs;
}
