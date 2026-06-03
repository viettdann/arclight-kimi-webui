import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { KimiConfigRow } from 'shared/types/kimi-config';
import type { DB } from '../../db';
import { env } from '../../env';
import { getKimiConfig } from './get-kimi-config';
import { resolveShareDir } from './share-dir';
import { writeConfigToml } from './write-toml';

export type WriteTomlMode = 'if-missing' | 'always' | 'never';

export interface BootstrapOpts {
  shareDir?: string;
  /** Override the env-controlled write policy. Tests pass this directly. */
  writeTomlMode?: WriteTomlMode;
}

export async function bootstrap(
  db: DB,
  opts?: BootstrapOpts,
): Promise<{ row: KimiConfigRow; shareDir: string; tomlWritten: boolean }> {
  const shareDir = opts?.shareDir ?? resolveShareDir();
  const mode: WriteTomlMode = opts?.writeTomlMode ?? env.KIMI_CONFIG_WRITE_TOML;

  mkdirSync(shareDir, { mode: 0o700, recursive: true });
  mkdirSync(path.join(shareDir, 'sessions'), { mode: 0o700, recursive: true });
  mkdirSync(path.join(shareDir, 'credentials'), { mode: 0o700, recursive: true });

  const row = await getKimiConfig(db);

  const tomlPath = path.join(shareDir, 'config.toml');
  const shouldWrite = mode === 'always' || (mode === 'if-missing' && !existsSync(tomlPath));

  if (shouldWrite) {
    writeConfigToml(row, shareDir);
  }

  return { row, shareDir, tomlWritten: shouldWrite };
}
