import { createKimiPaths, type KimiPathsType } from '@moonshot-ai/kimi-agent-sdk';
import { resolveShareDir } from './share-dir';

let cached: KimiPathsType | null = null;
let cachedFor: string | null = null;

export function kimiPaths(): KimiPathsType {
  const dir = resolveShareDir();
  if (cached && cachedFor === dir) return cached;
  cached = createKimiPaths(dir);
  cachedFor = dir;
  return cached;
}
