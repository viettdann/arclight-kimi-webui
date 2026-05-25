import type { KimiConfigRow } from 'shared/types/kimi-config';
import { computeConfigStatus } from './status';

const TEST_TIMEOUT_MS = 10_000;

export type FetchFn = typeof fetch;

// Issue a real `GET ${baseUrl}/models` against the configured provider with
// the configured api_key. This is the same endpoint upstream Kimi CLI uses to
// validate platform access (see kimi_cli/auth/platforms.py:267-282), so a 200
// response is conclusive proof that base_url + api_key authenticate.
//
// Not a token cost: /models lists models, no LLM call. Anthropic/Gemini/Vertex
// don't expose a free probe endpoint via this shape — for those, we fall back
// to the readiness-only check.
export async function testConnection(
  row: KimiConfigRow,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: boolean; error?: string }> {
  const status = computeConfigStatus(row);
  if (!status.ready) {
    return { ok: false, error: `Missing: ${status.missing.join(', ')}` };
  }

  const { provider } = row;
  if (
    provider.type !== 'kimi' &&
    provider.type !== 'openai_legacy' &&
    provider.type !== 'openai_responses'
  ) {
    return { ok: true };
  }

  const url = `${provider.baseUrl.replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...provider.customHeaders,
      },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Auth rejected (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} from ${url}` };
    }
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) {
      return { ok: false, error: `Timeout after ${TEST_TIMEOUT_MS}ms contacting ${url}` };
    }
    return { ok: false, error: `Network error: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
