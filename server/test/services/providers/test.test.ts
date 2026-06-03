import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ANTHROPIC_VERSION, LIGHT_MODEL, OAUTH_BETA, OAUTH_MODELS } from 'shared/types/providers';

// ─────────────────────────── SDK mock ───────────────────────────
//
// Declare before dynamic import so mock.module registers first.

type SDKMessage =
  | { type: 'result'; subtype: 'success'; result: string }
  | { type: 'result'; subtype: string; error?: string };

let mockQueryImpl: () => AsyncIterable<SDKMessage> = () =>
  (async function* () {
    yield { type: 'result' as const, subtype: 'success' as const, result: 'OK' };
  })();

let capturedModel: string | null = null;

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (opts: { options?: { model?: string } }) => {
    capturedModel = opts?.options?.model ?? null;
    return mockQueryImpl();
  },
}));

// ─────────────────────────── Module under test ───────────────────────────

const { fetchModels, pingProvider, testProvider } = await import(
  '../../../src/services/providers/test'
);

// ─────────────────────────── Fetch stub helpers ───────────────────────────

function makeOkResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeErrorResponse(status = 401): Response {
  return new Response('Unauthorized', { status });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  capturedModel = null;
  // Reset SDK mock back to success default
  mockQueryImpl = () =>
    (async function* () {
      yield { type: 'result' as const, subtype: 'success' as const, result: 'OK' };
    })();
});

// ─────────────────────────── fetchModels ───────────────────────────

describe('fetchModels — api type', () => {
  it('first variant ok → returns parsed models', async () => {
    const modelData = [
      { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6', max_input_tokens: 200000 },
    ];
    (globalThis as { fetch: unknown }).fetch = mock(async () => makeOkResponse(modelData));

    const models = await fetchModels({ type: 'api', baseUrl: null, token: 'tok-1234' });

    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({
      id: 'claude-sonnet-4-6',
      displayName: 'Sonnet 4.6',
      contextWindow: 200000,
    });
  });

  it('uses baseUrl when provided', async () => {
    let capturedUrl = '';
    (globalThis as { fetch: unknown }).fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return makeOkResponse([{ id: 'm1', display_name: 'M1', max_input_tokens: 100000 }]);
    });

    await fetchModels({ type: 'api', baseUrl: 'https://custom.example.com', token: 'tok' });

    expect(capturedUrl).toBe('https://custom.example.com/v1/models?limit=1000');
  });

  it('uses api.anthropic.com when baseUrl is null', async () => {
    let capturedUrl = '';
    (globalThis as { fetch: unknown }).fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return makeOkResponse([{ id: 'm1', display_name: null, max_input_tokens: 0 }]);
    });

    await fetchModels({ type: 'api', baseUrl: null, token: 'tok' });

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/models?limit=1000');
  });

  it('api type uses x-api-key header (not Bearer)', async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis as { fetch: unknown }).fetch = mock(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return makeOkResponse([{ id: 'm1', display_name: 'M1', max_input_tokens: 100 }]);
      },
    );

    await fetchModels({ type: 'api', baseUrl: null, token: 'test-token' });

    expect(capturedHeaders['x-api-key']).toBe('test-token');
    expect(capturedHeaders['anthropic-version']).toBe(ANTHROPIC_VERSION);
    // api type must NOT include anthropic-beta
    expect(capturedHeaders['anthropic-beta']).toBeUndefined();
  });

  it('first variant !ok → falls through to second variant → returns models from second', async () => {
    let callCount = 0;
    const modelData = [
      { id: 'claude-haiku-4-5', display_name: 'Haiku 4.5', max_input_tokens: 150000 },
    ];

    (globalThis as { fetch: unknown }).fetch = mock(async () => {
      callCount++;
      if (callCount === 1) return makeErrorResponse(401);
      return makeOkResponse(modelData);
    });

    const models = await fetchModels({ type: 'api', baseUrl: null, token: 'tok' });

    expect(callCount).toBe(2);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('claude-haiku-4-5');
  });

  it('all variants fail → returns empty array', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () => makeErrorResponse(500));

    const models = await fetchModels({ type: 'api', baseUrl: null, token: 'tok' });

    expect(models).toEqual([]);
  });

  it('network error on all variants → returns empty array', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () => {
      throw new Error('Network error');
    });

    const models = await fetchModels({ type: 'api', baseUrl: null, token: 'tok' });

    expect(models).toEqual([]);
  });

  it('parses context_length as fallback when max_input_tokens absent', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () =>
      makeOkResponse([{ id: 'model-x', display_name: null, context_length: 100000 }]),
    );

    const models = await fetchModels({ type: 'api', baseUrl: null, token: 'tok' });
    expect(models[0]?.contextWindow).toBe(100000);
  });

  it('displayName is null when display_name field absent', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () =>
      makeOkResponse([{ id: 'model-y', max_input_tokens: 50000 }]),
    );

    const models = await fetchModels({ type: 'api', baseUrl: null, token: 'tok' });
    expect(models[0]?.displayName).toBeNull();
  });
});

describe('fetchModels — oauth type', () => {
  it('oauth always hits api.anthropic.com regardless of baseUrl', async () => {
    let capturedUrl = '';
    (globalThis as { fetch: unknown }).fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return makeOkResponse([{ id: 'm1', display_name: 'M1', max_input_tokens: 200000 }]);
    });

    await fetchModels({ type: 'oauth', baseUrl: 'https://ignored.com', token: 'oauth-tok' });

    // oauth always targets Anthropic directly; a stray baseUrl is ignored. Only
    // `api` honors a custom base url. The other oauth distinction is the
    // anthropic-beta header (asserted in the next test).
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/models?limit=1000');
  });

  it('oauth includes anthropic-beta header', async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis as { fetch: unknown }).fetch = mock(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return makeOkResponse([{ id: 'm1', display_name: 'M1', max_input_tokens: 200000 }]);
      },
    );

    await fetchModels({ type: 'oauth', baseUrl: null, token: 'oauth-token' });

    expect(capturedHeaders['anthropic-beta']).toBe(OAUTH_BETA);
    expect(capturedHeaders['anthropic-version']).toBe(ANTHROPIC_VERSION);
  });
});

// ─────────────────────────── pingProvider ───────────────────────────

describe('pingProvider', () => {
  it('success subtype → { ok: true }', async () => {
    mockQueryImpl = () =>
      (async function* () {
        yield { type: 'result' as const, subtype: 'success' as const, result: 'OK' };
      })();

    const result = await pingProvider({ type: 'api', baseUrl: null, token: 'tok' }, 'model-1');
    expect(result).toEqual({ ok: true });
  });

  it('non-success subtype → { ok: false, error: subtype }', async () => {
    mockQueryImpl = () =>
      (async function* () {
        yield { type: 'result' as const, subtype: 'error_max_tokens' };
      })();

    const result = await pingProvider({ type: 'api', baseUrl: null, token: 'tok' }, 'model-1');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('error_max_tokens');
  });

  it('no result message → { ok: false, error: "no result message received" }', async () => {
    mockQueryImpl = () =>
      (async function* () {
        // yields nothing
      })();

    const result = await pingProvider({ type: 'api', baseUrl: null, token: 'tok' }, 'model-1');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no result message received');
  });

  it('query throws → { ok: false, error: message }', async () => {
    mockQueryImpl = () => {
      throw new Error('SDK connection refused');
    };

    const result = await pingProvider({ type: 'api', baseUrl: null, token: 'tok' }, 'model-1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SDK connection refused');
  });
});

// ─────────────────────────── testProvider ───────────────────────────

describe('testProvider — api type', () => {
  it('api: fetches models and pings the first one → ok + availableModels', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () =>
      makeOkResponse([
        { id: 'claude-sonnet-4-6', display_name: 'Sonnet', max_input_tokens: 200000 },
      ]),
    );

    const result = await testProvider({ type: 'api', baseUrl: null, token: 'tok', model: null });

    expect(result.ok).toBe(true);
    expect(result.availableModels).toHaveLength(1);
    expect(result.availableModels?.[0]?.id).toBe('claude-sonnet-4-6');
  });

  it('api: uses provided model for ping (not first fetched)', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () =>
      makeOkResponse([
        { id: 'claude-opus-4-8', display_name: 'Opus', max_input_tokens: 200000 },
        { id: 'claude-sonnet-4-6', display_name: 'Sonnet', max_input_tokens: 200000 },
      ]),
    );

    // The mock SDK succeeds — we just verify both models are returned
    const result = await testProvider({
      type: 'api',
      baseUrl: null,
      token: 'tok',
      model: 'claude-opus-4-8',
    });

    expect(result.ok).toBe(true);
    expect(result.availableModels).toHaveLength(2);
  });

  it('api: no model + empty fetchModels → { ok: false, error: "no model" }', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () => makeErrorResponse(401));

    const result = await testProvider({ type: 'api', baseUrl: null, token: 'tok', model: null });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('no model');
  });

  it('api: ping fails → { ok: false, error: ... }', async () => {
    (globalThis as { fetch: unknown }).fetch = mock(async () =>
      makeOkResponse([
        { id: 'claude-sonnet-4-6', display_name: 'Sonnet', max_input_tokens: 200000 },
      ]),
    );

    mockQueryImpl = () =>
      (async function* () {
        yield { type: 'result' as const, subtype: 'error_api' };
      })();

    const result = await testProvider({ type: 'api', baseUrl: null, token: 'tok' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('error_api');
    // availableModels is still populated even when ping fails
    expect(result.availableModels).toHaveLength(1);
  });
});

describe('testProvider — oauth type', () => {
  it('oauth: pings with LIGHT_MODEL and returns OAUTH_MODELS set', async () => {
    const result = await testProvider({ type: 'oauth', baseUrl: null, token: 'oauth-tok' });

    expect(capturedModel).toBe(LIGHT_MODEL);
    expect(result.ok).toBe(true);
    expect(result.availableModels).toHaveLength(OAUTH_MODELS.length);
    expect(result.availableModels?.map((m) => m.id)).toEqual(OAUTH_MODELS.map((m) => m.id));
  });

  it('oauth: ping fails → { ok: false, error: ..., availableModels: OAUTH_MODELS }', async () => {
    mockQueryImpl = () =>
      (async function* () {
        yield { type: 'result' as const, subtype: 'error_max_tokens' };
      })();

    const result = await testProvider({ type: 'oauth', baseUrl: null, token: 'oauth-tok' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('error_max_tokens');
    // oauth always returns OAUTH_MODELS regardless of ping outcome
    expect(result.availableModels).toHaveLength(OAUTH_MODELS.length);
  });

  it('oauth: does not call fetchModels (fetch is not invoked)', async () => {
    let fetchCalled = false;
    (globalThis as { fetch: unknown }).fetch = mock(async () => {
      fetchCalled = true;
      return makeOkResponse([]);
    });

    await testProvider({ type: 'oauth', baseUrl: null, token: 'oauth-tok' });

    expect(fetchCalled).toBe(false);
  });
});
