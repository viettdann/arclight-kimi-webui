import path from 'node:path';
import { env } from '../../env';

const PROJECT_ROOT = path.resolve(import.meta.dir, '../../../..');
const PROD_SHARE_DIR = '/app/.kimi';

export function resolveShareDir(): string {
  const raw = env.KIMI_SHARE_DIR;
  if (raw === undefined || raw === '') {
    return env.NODE_ENV === 'production' ? PROD_SHARE_DIR : path.join(PROJECT_ROOT, '.kimi');
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  return path.resolve(PROJECT_ROOT, raw);
}
