import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  __resetInflightForTests,
  cleanTitle,
  generateTitleViaAnthropic,
  maybeGenerateTitleBackground,
  readFirstTurnFromWire,
  shortenForTitle,
  type TitleProviderConfig,
} from '../src/services/title-generate';
import { makeFakeDb } from './_helpers';

afterEach(() => {
  __resetInflightForTests();
});

// ─────────────────────────── cleanTitle / shortenForTitle ───────────────────────────

describe('cleanTitle', () => {
  it('strips surrounding quotes and whitespace', () => {
    expect(cleanTitle(' "Hello world"\n')).toBe('Hello world');
    expect(cleanTitle("'single quoted'")).toBe('single quoted');
    expect(cleanTitle('`backtick`')).toBe('backtick');
  });

  it('passes through normal text', () => {
    expect(cleanTitle('A clean title')).toBe('A clean title');
  });

  it('truncates strings longer than 50 chars with ellipsis', () => {
    const long = 'a'.repeat(80);
    const out = cleanTitle(long);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('shortenForTitle', () => {
  it('collapses whitespace and trims', () => {
    expect(shortenForTitle('  hello   \n  world  ')).toBe('hello world');
  });

  it('truncates long input', () => {
    expect(shortenForTitle('x'.repeat(100)).length).toBe(50);
  });
});

// ─────────────────────────── readFirstTurnFromWire ───────────────────────────

describe('readFirstTurnFromWire', () => {
  const tmps: string[] = [];
  afterEach(async () => {
    await Promise.all(tmps.map((d) => rm(d, { recursive: true, force: true })));
    tmps.length = 0;
  });
  const writeFixture = async (content: string): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), 'title-wire-'));
    tmps.push(dir);
    const file = path.join(dir, 'wire.jsonl');
    await writeFile(file, content, 'utf8');
    return file;
  };

  it('returns null for missing file', async () => {
    expect(await readFirstTurnFromWire('/tmp/does-not-exist.jsonl')).toBeNull();
  });

  it('returns null for empty file', async () => {
    const file = await writeFixture('');
    expect(await readFirstTurnFromWire(file)).toBeNull();
  });

  it('parses string user_input + first text ContentPart', async () => {
    const lines = [
      JSON.stringify({ message: { type: 'metadata', protocol_version: '1.10' } }),
      JSON.stringify({
        message: { type: 'TurnBegin', payload: { user_input: 'Hello agent' } },
      }),
      JSON.stringify({
        message: { type: 'ContentPart', payload: { type: 'think', think: 'thinking…' } },
      }),
      JSON.stringify({
        message: { type: 'ContentPart', payload: { type: 'text', text: 'Hi there' } },
      }),
      JSON.stringify({
        message: { type: 'ContentPart', payload: { type: 'text', text: 'second text' } },
      }),
    ].join('\n');
    const file = await writeFixture(lines);
    const out = await readFirstTurnFromWire(file);
    expect(out).toEqual({ userText: 'Hello agent', assistantText: 'Hi there' });
  });

  it('parses array-shaped user_input by joining text parts', async () => {
    const lines = [
      JSON.stringify({
        message: {
          type: 'TurnBegin',
          payload: {
            user_input: [
              { type: 'text', text: 'first line' },
              { type: 'image_url', image_url: { url: 'data:…' } },
              { type: 'text', text: 'second line' },
            ],
          },
        },
      }),
      JSON.stringify({
        message: { type: 'ContentPart', payload: { type: 'text', text: 'reply' } },
      }),
    ].join('\n');
    const file = await writeFixture(lines);
    const out = await readFirstTurnFromWire(file);
    expect(out).toEqual({ userText: 'first line\nsecond line', assistantText: 'reply' });
  });

  it('tolerates malformed lines and missing assistant text', async () => {
    const lines = [
      'not json',
      JSON.stringify({ unrelated: true }),
      JSON.stringify({
        message: { type: 'TurnBegin', payload: { user_input: 'only user' } },
      }),
      '{"broken": ',
    ].join('\n');
    const file = await writeFixture(lines);
    const out = await readFirstTurnFromWire(file);
    expect(out).toEqual({ userText: 'only user', assistantText: '' });
  });

  it('returns null if no TurnBegin found', async () => {
    const lines = JSON.stringify({
      message: { type: 'ContentPart', payload: { type: 'text', text: 'orphan' } },
    });
    const file = await writeFixture(lines);
    expect(await readFirstTurnFromWire(file)).toBeNull();
  });
});

// ─────────────────────────── generateTitleViaAnthropic ───────────────────────────

const cfg: TitleProviderConfig = {
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'sk-test',
  model: 'kimi-for-coding',
};

describe('generateTitleViaAnthropic', () => {
  it('parses the first text block from a 200 response', async () => {
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      expect(url).toBe('https://api.kimi.com/coding/v1/messages');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
      expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
      const body = JSON.parse(init.body as string) as { model: string; messages: unknown[] };
      expect(body.model).toBe('kimi-for-coding');
      expect(body.messages).toHaveLength(1);
      return new Response(
        JSON.stringify({
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Refactor auth flow' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const title = await generateTitleViaAnthropic(
      cfg,
      'help me refactor auth',
      'sure I will…',
      fetchImpl as unknown as typeof fetch,
    );
    expect(title).toBe('Refactor auth flow');
  });

  it('strips surrounding quotes from response', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: '"Quoted Title"' }] }), {
        status: 200,
      });
    const title = await generateTitleViaAnthropic(
      cfg,
      'u',
      'a',
      fetchImpl as unknown as typeof fetch,
    );
    expect(title).toBe('Quoted Title');
  });

  it('throws on HTTP 401', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    await expect(
      generateTitleViaAnthropic(cfg, 'u', 'a', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('throws on empty content array', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ content: [] }), { status: 200 });
    await expect(
      generateTitleViaAnthropic(cfg, 'u', 'a', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/empty content/);
  });

  it('throws when no text block in content array', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'foo' }] }), {
        status: 200,
      });
    await expect(
      generateTitleViaAnthropic(cfg, 'u', 'a', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/no text block/);
  });

  it('caps user/assistant text to prevent huge prompts', async () => {
    let capturedBody = '';
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
      });
    };
    await generateTitleViaAnthropic(
      cfg,
      'u'.repeat(1000),
      'a'.repeat(1000),
      fetchImpl as unknown as typeof fetch,
    );
    const parsed = JSON.parse(capturedBody) as { messages: Array<{ content: string }> };
    const first = parsed.messages[0];
    if (!first) throw new Error('expected at least one message');
    // 300 (user) + 300 (assistant) + ~30 chars of scaffolding < 700
    expect(first.content.length).toBeLessThan(700);
  });
});

// ─────────────────────────── maybeGenerateTitleBackground ───────────────────────────

interface StubActive {
  sessionId: string;
  workDir: string;
  kimiSessionId: string;
  wsSet: Set<unknown>;
  eventBuffer: { push: (m: unknown) => void };
}

function stubActive(): StubActive {
  return {
    sessionId: 'sess-1',
    workDir: '/tmp/work',
    kimiSessionId: 'kimi-1',
    wsSet: new Set(),
    eventBuffer: { push: () => {} },
  };
}

const stubManager = {
  allocSeq: (_a: unknown) => 1,
} as unknown as Parameters<typeof maybeGenerateTitleBackground>[1];

describe('maybeGenerateTitleBackground', () => {
  it('skips when session already has a title', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ title: 'Existing Title' }]);
    let fetched = false;
    await maybeGenerateTitleBackground(
      stubActive() as unknown as Parameters<typeof maybeGenerateTitleBackground>[0],
      stubManager,
      fake.db,
      {
        fetchImpl: (async () => {
          fetched = true;
          return new Response('', { status: 200 });
        }) as unknown as typeof fetch,
        loadConfig: async () => cfg,
        readWire: async () => ({ userText: 'u', assistantText: 'a' }),
        resolveWirePath: () => '/tmp/wire.jsonl',
      },
    );
    expect(fetched).toBe(false);
    // no update call recorded
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('skips when session row does not exist', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    await maybeGenerateTitleBackground(
      stubActive() as unknown as Parameters<typeof maybeGenerateTitleBackground>[0],
      stubManager,
      fake.db,
      {
        loadConfig: async () => cfg,
        readWire: async () => ({ userText: 'u', assistantText: 'a' }),
        resolveWirePath: () => '/tmp/wire.jsonl',
      },
    );
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('generates title via Anthropic, writes DB and broadcasts', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ title: null }]);
    let fetched = false;
    await maybeGenerateTitleBackground(
      stubActive() as unknown as Parameters<typeof maybeGenerateTitleBackground>[0],
      stubManager,
      fake.db,
      {
        fetchImpl: (async () => {
          fetched = true;
          return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Generated' }] }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
        loadConfig: async () => cfg,
        readWire: async () => ({ userText: 'help me refactor', assistantText: 'sure' }),
        resolveWirePath: () => '/tmp/wire.jsonl',
      },
    );
    expect(fetched).toBe(true);
    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect((updates[0]?.values as { title: string }).title).toBe('Generated');
  });

  it('falls back to shortened user text on HTTP failure', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ title: null }]);
    await maybeGenerateTitleBackground(
      stubActive() as unknown as Parameters<typeof maybeGenerateTitleBackground>[0],
      stubManager,
      fake.db,
      {
        fetchImpl: (async () => new Response('error', { status: 500 })) as unknown as typeof fetch,
        loadConfig: async () => cfg,
        readWire: async () => ({
          userText: 'help me refactor the auth flow please',
          assistantText: 'sure',
        }),
        resolveWirePath: () => '/tmp/wire.jsonl',
      },
    );
    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    const title = (updates[0]?.values as { title: string }).title;
    expect(title).toBe('help me refactor the auth flow please');
  });

  it('falls back to shortened user text when config has no provider', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ title: null }]);
    await maybeGenerateTitleBackground(
      stubActive() as unknown as Parameters<typeof maybeGenerateTitleBackground>[0],
      stubManager,
      fake.db,
      {
        loadConfig: async () => null,
        readWire: async () => ({ userText: 'fallback path', assistantText: '' }),
        resolveWirePath: () => '/tmp/wire.jsonl',
      },
    );
    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect((updates[0]?.values as { title: string }).title).toBe('fallback path');
  });

  it('no-ops when wire has no first turn', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ title: null }]);
    await maybeGenerateTitleBackground(
      stubActive() as unknown as Parameters<typeof maybeGenerateTitleBackground>[0],
      stubManager,
      fake.db,
      {
        loadConfig: async () => cfg,
        readWire: async () => null,
        resolveWirePath: () => '/tmp/wire.jsonl',
      },
    );
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });
});
