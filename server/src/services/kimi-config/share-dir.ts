import { homedir } from 'node:os';
import path from 'node:path';
import { env } from '../../env';

export function resolveShareDir(): string {
  return path.resolve(env.KIMI_SHARE_DIR ?? path.join(homedir(), '.kimi'));
}
