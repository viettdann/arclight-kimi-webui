import { afterEach, describe, expect, it, mock } from 'bun:test';

// `api` providers title via a raw Messages API call (global fetch); `oauth`
// providers go through the Agent SDK `query`. Both boundaries are mocked: fetch
// is swapped per-test, and `query` is captured so the oauth path's model
// threading can be asserted.

interface QueryCall {
  model?: unknown;
  prompt?: unknown;
}
const queryCalls: QueryCall[] = [];

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: { model?: string } }) => {
    queryCalls.push({ model: options?.model, prompt });
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'Fix login button on mobile' };
    })();
  },
}));

const { generateTitle } = await import('../../src/services/agent/title');

const realFetch = globalThis.fetch;

/** Build a Messages-API-shaped JSON Response. */
function messagesResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  queryCalls.length = 0;
});

describe('generateTitle — api provider (raw Messages API)', () => {
  it('posts to <baseUrl>/v1/messages with the caller model and returns the cleaned title', async () => {
    const seen: { url: string; body: unknown; headerKeys: string[] }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        headerKeys: Object.keys(init.headers as Record<string, string>),
      });
      return messagesResponse('Fix websocket reconnect drops');
    }) as unknown as typeof fetch;

    const title = await generateTitle(
      'fix the websocket reconnect logic',
      { type: 'api', baseUrl: 'https://proxy.example.com/api/coding', token: 'k' },
      'proxy-model-1',
    );

    expect(title).toBe('Fix websocket reconnect drops');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://proxy.example.com/api/coding/v1/messages');
    expect((seen[0]?.body as { model: string }).model).toBe('proxy-model-1');
    // First attempt uses the x-api-key header variant.
    expect(seen[0]?.headerKeys).toContain('x-api-key');
    // The SDK query path is never touched for api providers.
    expect(queryCalls).toHaveLength(0);
  });

  it('falls back to the Bearer header when x-api-key is rejected (401)', async () => {
    const authHeaders: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      if (headers['x-api-key']) {
        authHeaders.push('x-api-key');
        return messagesResponse('', 401);
      }
      authHeaders.push('authorization');
      return messagesResponse('Add retry to api client');
    }) as unknown as typeof fetch;

    const title = await generateTitle(
      'add retry',
      { type: 'api', baseUrl: null, token: 'bearer-token' },
      'some-model',
    );

    expect(title).toBe('Add retry to api client');
    expect(authHeaders).toEqual(['x-api-key', 'authorization']);
  });

  it('defaults the base url to api.anthropic.com when none is set', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (url: string) => {
      calledUrl = String(url);
      return messagesResponse('Some title');
    }) as unknown as typeof fetch;

    await generateTitle('hello', { type: 'api', baseUrl: null, token: 'k' }, 'm');

    expect(calledUrl).toBe('https://api.anthropic.com/v1/messages');
  });

  it('returns null on a non-auth error status', async () => {
    globalThis.fetch = (async () => messagesResponse('', 500)) as unknown as typeof fetch;
    const title = await generateTitle('hello', { type: 'api', baseUrl: null, token: 'k' }, 'm');
    expect(title).toBeNull();
  });

  it('rejects an over-long title', async () => {
    globalThis.fetch = (async () => messagesResponse('x'.repeat(200))) as unknown as typeof fetch;
    const title = await generateTitle('hello', { type: 'api', baseUrl: null, token: 'k' }, 'm');
    expect(title).toBeNull();
  });
});

describe('generateTitle — oauth provider (Agent SDK)', () => {
  it('threads the model through the SDK query and never calls fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return messagesResponse('should not be used');
    }) as unknown as typeof fetch;

    const title = await generateTitle(
      'first user message',
      { type: 'oauth', baseUrl: null, token: 'oauth-token' },
      'claude-haiku-4-5-20251001',
    );

    expect(title).toBe('Fix login button on mobile');
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.model).toBe('claude-haiku-4-5-20251001');
    expect(fetchCalled).toBe(false);
  });
});
