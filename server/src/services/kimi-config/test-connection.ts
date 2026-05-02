import type { KimiConfigRow } from 'shared/types/kimi-config';

export async function testConnection(row: KimiConfigRow): Promise<{ ok: boolean; error?: string }> {
  // Placeholder: a full implementation would import the SDK, spawn a temporary
  // session with the resolved env vars, send a lightweight prompt, and await a
  // response with a 10-second timeout. For now, we gate on the presence of an
  // API key so the UI can show a meaningful status immediately.
  if (row.provider.apiKey.length === 0) {
    return { ok: false, error: 'No API key configured' };
  }

  // TODO: replace with real SDK test once @moonshot-ai/kimi-agent-sdk is available
  return { ok: true };
}
