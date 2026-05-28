import type { DB } from '../../db';
import { buildEnvFromRow } from './env';
import { getKimiConfig } from './get-kimi-config';

export async function loadEnvForInjection(db: DB): Promise<Record<string, string>> {
  try {
    const configRow = await getKimiConfig(db);
    return buildEnvFromRow(configRow);
  } catch {
    // Config table may not exist in test fakes; proceed without env injection.
    // `getKimiConfig` does not throw on missing row, but the underlying SELECT
    // can throw on DB connectivity errors.
    return {};
  }
}
