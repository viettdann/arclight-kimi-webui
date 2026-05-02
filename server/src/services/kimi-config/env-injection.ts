import type { DB } from '../../db';
import { buildEnvFromRow } from './env';
import { loadOrSeed } from './load-or-seed';

export async function loadEnvForInjection(db: DB): Promise<Record<string, string>> {
  try {
    const configRow = await loadOrSeed(db);
    return buildEnvFromRow(configRow);
  } catch {
    // Config table may not exist in test fakes; proceed without env injection.
    return {};
  }
}
