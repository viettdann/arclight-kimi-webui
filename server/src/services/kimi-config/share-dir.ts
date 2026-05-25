import { homedir } from 'node:os';
import path from 'node:path';
import { env } from '../../env';

// `server/src/services/kimi-config/share-dir.ts` → project root is four up.
// Mirrors env.ts's PROJECT_ROOT pattern so relative KIMI_SHARE_DIR resolves
// against the repo root regardless of the script's cwd.
const PROJECT_ROOT = path.resolve(import.meta.dir, '../../../..');

export function resolveShareDir(): string {
  const raw = env.KIMI_SHARE_DIR;
  if (raw === undefined || raw === '') {
    return path.join(homedir(), '.kimi');
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  return path.resolve(PROJECT_ROOT, raw);
}
