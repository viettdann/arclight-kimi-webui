import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { KimiConfigRow } from 'shared/types/kimi-config';
import type { DB } from '../../db';
import { loadOrSeed } from './load-or-seed';
import { resolveShareDir } from './share-dir';
import { writeConfigToml } from './write-toml';

export async function bootstrap(
  db: DB,
  opts?: { shareDir?: string },
): Promise<{ row: KimiConfigRow; shareDir: string }> {
  const shareDir = opts?.shareDir ?? resolveShareDir();

  mkdirSync(shareDir, { mode: 0o700, recursive: true });
  mkdirSync(path.join(shareDir, 'sessions'), { mode: 0o700, recursive: true });
  mkdirSync(path.join(shareDir, 'credentials'), { mode: 0o700, recursive: true });

  const row = await loadOrSeed(db);
  writeConfigToml(row, shareDir);

  return { row, shareDir };
}
