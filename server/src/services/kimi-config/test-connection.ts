import type { KimiConfigRow } from 'shared/types/kimi-config';
import { computeConfigStatus } from './status';

const TEST_TIMEOUT_MS = 10_000;

export type FetchFn = typeof fetch;

// Strip any trailing slashes from baseUrl, then ensure the path ends with `/v1`.
// Users frequently configure base URLs with or without the `/v1` suffix; the
// probe must hit the OpenAI-style `/v1/models` (or Anthropic `/v1/models`)
// path regardless.
export function withV1(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

// Issue a real `GET ${baseUrl}/v1/models` against the configured provider with
// the configured api_key. This is the same endpoint upstream Kimi CLI uses to
// validate platform access (see kimi_cli/auth/platforms.py:267-282), so a 200
// response is conclusive proof that base_url + api_key authenticate.
//
// Not a token cost: /models lists models, no LLM call.
export async function testConnection(
  row: KimiConfigRow,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: boolean; error?: string }> {
  const status = computeConfigStatus(row);
  if (!status.ready) {
    return { ok: false, error: `Missing: ${status.missing.join(', ')}` };
  }

  const { provider } = row;
  const url = `${withV1(provider.baseUrl)}/models`;

  // customHeaders spread first so server-controlled auth headers always win;
  // a misconfigured row must not be able to redirect the probe credentials.
  const headers: Record<string, string> =
    provider.type === 'anthropic'
      ? {
          ...provider.customHeaders,
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        }
      : {
          ...provider.customHeaders,
          Authorization: `Bearer ${provider.apiKey}`,
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers,
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
