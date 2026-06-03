import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/session-manager';

// Title is settled on turn end by `maybePersistTitle`. Precedence:
//   manual          → never overwritten.
//   binary ai-title → mirrored as `ai`, overriding any prior `fallback`.
//   none + untitled → self-generated `fallback` from the first user prompt.
// Both inputs (ai-title + first user text) come from the persisted transcript
// via `readTranscriptTitleInputs`; the fallback path calls `generateTitle`.

const broadcasts: { type: string }[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string) => {
    broadcasts.push({ type });
    return { type };
  },
}));

// Swappable per-test stored session title + its provenance.
let storedTitle: string | null = null;
let storedTitleSource: string | null = null;
// Captures the last title-bearing db.update(...).set({ title, titleSource }).
// Usage/other updates carry no `title` key, so they are ignored here.
let persisted: { title: string; titleSource: unknown } | null = null;
mock.module('../../src/db', () => ({
  db: {
    query: {
      sessions: { findFirst: async () => ({ title: storedTitle, titleSource: storedTitleSource }) },
    },
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          if (typeof v.title === 'string')
            persisted = { title: v.title, titleSource: v.titleSource };
        },
      }),
    }),
  },
  schema: { sessions: {} },
}));

// Title inputs the binary left in the transcript this turn.
let transcriptAiTitle: string | null = null;
let transcriptFirstUser: string | null = null;
mock.module('../../src/services/agent/transcript-store', () => ({
  readTranscriptTitleInputs: async () => ({
    aiTitle: transcriptAiTitle,
    firstUserText: transcriptFirstUser,
  }),
}));

// Self-generated fallback. `generatedTitle` is the value; `genArgs` records the
// first-user text it was asked to title (null = not called).
let generatedTitle: string | null = null;
let genArgs: string | null = null;
mock.module('../../src/services/agent/title', () => ({
  generateTitle: async (firstUserText: string) => {
    genArgs = firstUserText;
    return generatedTitle;
  },
}));

mock.module('../../src/services/providers/resolve', () => ({
  resolveProviderForUser: async () => ({ type: 'api', baseUrl: null, token: 'k' }),
}));

const { consumeQueryOutput } = await import('../../src/services/agent/output-consumer');
const { SessionManager } = await import('../../src/services/session-manager');

function makeQuery(messages: unknown[]): ActiveSession['query'] {
  return (async function* () {
    for (const m of messages) yield m;
  })() as unknown as ActiveSession['query'];
}

const RESULT = {
  type: 'result',
  subtype: 'success',
  num_turns: 1,
  usage: { input_tokens: 10, output_tokens: 5 },
  total_cost_usd: 0.01,
};

function makeSession() {
  const sm = new SessionManager();
  const active = sm.register({
    sessionId: 's1',
    userId: 'u1',
    workDir: '/tmp/w',
    model: 'ark-code-latest',
    providerId: 'p1',
    approvalMode: 'ask',
  });
  // maybePersistTitle reads the local transcript only when an sdkSessionId is known.
  active.sdkSessionId = 'sdk-1';
  return active;
}

async function runTurn() {
  const active = makeSession();
  active.query = makeQuery([RESULT]);
  await consumeQueryOutput(active);
}

beforeEach(() => {
  broadcasts.length = 0;
  storedTitle = null;
  storedTitleSource = null;
  transcriptAiTitle = null;
  transcriptFirstUser = null;
  generatedTitle = null;
  genArgs = null;
  persisted = null;
});

describe('output-consumer title settle', () => {
  it('mirrors the binary ai-title as source=ai', async () => {
    transcriptAiTitle = 'Find current project directory';
    await runTurn();

    expect(persisted).toEqual({ title: 'Find current project directory', titleSource: 'ai' });
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(true);
    expect(genArgs).toBeNull(); // no fallback call when the binary supplied one
  });

  it('does not rewrite when the ai-title is already mirrored', async () => {
    storedTitle = 'Already mirrored';
    storedTitleSource = 'ai';
    transcriptAiTitle = 'Already mirrored';
    await runTurn();

    expect(persisted).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });

  it('lets a binary ai-title override a prior fallback title', async () => {
    storedTitle = 'Guessed fallback';
    storedTitleSource = 'fallback';
    transcriptAiTitle = 'Binary refined title';
    await runTurn();

    expect(persisted).toEqual({ title: 'Binary refined title', titleSource: 'ai' });
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(true);
  });

  it('self-generates a fallback when the binary wrote no ai-title', async () => {
    transcriptFirstUser = 'fix the websocket reconnect logic';
    generatedTitle = 'Fix websocket reconnect drops';
    await runTurn();

    expect(genArgs).toBe('fix the websocket reconnect logic');
    expect(persisted).toEqual({ title: 'Fix websocket reconnect drops', titleSource: 'fallback' });
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(true);
  });

  it('persists nothing when fallback generation yields no title', async () => {
    transcriptFirstUser = 'hello';
    generatedTitle = null;
    await runTurn();

    expect(genArgs).toBe('hello');
    expect(persisted).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });

  it('keeps an existing fallback while the binary still has no ai-title', async () => {
    storedTitle = 'Existing fallback';
    storedTitleSource = 'fallback';
    transcriptFirstUser = 'some prompt';
    await runTurn();

    expect(genArgs).toBeNull(); // not regenerated
    expect(persisted).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });

  it('never overwrites a manual title', async () => {
    storedTitle = 'User chose this';
    storedTitleSource = 'manual';
    transcriptAiTitle = 'Binary would-be title';
    transcriptFirstUser = 'some prompt';
    await runTurn();

    expect(persisted).toBeNull();
    expect(genArgs).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });

  it('does nothing when there is neither an ai-title nor a first user prompt', async () => {
    await runTurn();

    expect(persisted).toBeNull();
    expect(genArgs).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });
});
