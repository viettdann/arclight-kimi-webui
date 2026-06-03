import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { KimiConfigRow } from 'shared/types/kimi-config';
import { renderToml, shouldRedactSecrets } from './serialize';
import { resolveShareDir } from './share-dir';

export function writeConfigToml(row: KimiConfigRow, shareDir?: string): void {
  const dir = shareDir ?? resolveShareDir();
  mkdirSync(dir, { mode: 0o700, recursive: true });

  const toml = renderToml(row, { redactSecrets: shouldRedactSecrets(row.provider.type) });
  writeFileSync(path.join(dir, 'config.toml'), toml, { mode: 0o600 });
}
