import type { KimiConfigRow } from 'shared/types/kimi-config';
import { computeConfigStatus } from './status';

// We deliberately do NOT call SDK `parseConfig`/`isLoggedIn` here, despite the
// SDK exposing them: our `write-toml.ts` redacts the api_key for the kimi
// provider (the real key is injected to the CLI via KIMI_API_KEY env at
// session-create time), and our `[models.<name>]` table-of-tables format does
// not match what the SDK's parser produces (it returns `models: []`,
// `defaultModel: null` for our TOML). So the SDK functions would always
// return "not logged in" against our config, which is misleading.
//
// A truly conclusive "test" would have to either spawn the kimi-code CLI
// with full env injection (billable LLM call, requires PATH-reachable binary)
// or make a direct provider HTTP request (bypasses the SDK entirely). Both
// are too heavy for a config-page button click; defer to a separate ticket.
//
// For now: surface the same readiness signal as GET /api/config/status, so
// the UI can show actionable "missing X" errors instead of a green check
// hiding a misconfiguration.
export async function testConnection(row: KimiConfigRow): Promise<{ ok: boolean; error?: string }> {
  const status = computeConfigStatus(row);
  if (status.ready) {
    return { ok: true };
  }
  return { ok: false, error: `Missing: ${status.missing.join(', ')}` };
}
