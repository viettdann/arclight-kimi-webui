import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/session-manager';

// Title is mirrored from the SDK's own `ai-title` transcript entry — the binary
// generates it for free during a normal turn, so there is no extra API call on
// our side. The gate is solely `title IS NULL` (a turn that ran before the
// binary wrote the entry is retried next turn), and the value always comes from
// the persisted transcript via `aiTitleFromTranscript`.

const broadcasts: { type: string }[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string) => {
    broadcasts.push({ type });
    return { type };
  },
}));

// Swappable per-test stored title (the only session field the gate reads).
let storedTitle: string | null = null;
// Captures every `title` written via db.update(...).set({ title }). Usage and
// other updates carry no `title` key, so they are ignored here.
let persistedTitle: string | null = null;
mock.module('../../src/db', () => ({
  db: {
    query: { sessions: { findFirst: async () => ({ title: storedTitle }) } },
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          if (typeof v.title === 'string') persistedTitle = v.title;
        },
      }),
    }),
  },
  schema: { sessions: {} },
}));

// The AI title the binary wrote into the transcript (null = not written yet).
let transcriptAiTitle: string | null = null;
mock.module('../../src/services/agent/transcript-store', () => ({
  appendTranscript: async () => {},
  backupSubagents: async () => {},
  aiTitleFromTranscript: async () => transcriptAiTitle,
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
  // appendTranscript/backupSubagents only run when an sdkSessionId is known.
  active.sdkSessionId = 'sdk-1';
  return active;
}

beforeEach(() => {
  broadcasts.length = 0;
  storedTitle = null;
  transcriptAiTitle = null;
  persistedTitle = null;
});

describe('output-consumer title mirror', () => {
  it('persists + broadcasts the ai-title from the transcript', async () => {
    transcriptAiTitle = 'Find current project directory';
    const active = makeSession();
    active.query = makeQuery([RESULT]);

    await consumeQueryOutput(active);

    expect(persistedTitle).toBe('Find current project directory');
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(true);
  });

  it('skips when the session already has a title', async () => {
    storedTitle = 'Existing title';
    transcriptAiTitle = 'Some new title';
    const active = makeSession();
    active.query = makeQuery([RESULT]);

    await consumeQueryOutput(active);

    expect(persistedTitle).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });

  it('skips when the binary has not written an ai-title yet', async () => {
    const active = makeSession();
    active.query = makeQuery([RESULT]);

    await consumeQueryOutput(active);

    expect(persistedTitle).toBeNull();
    expect(broadcasts.some((b) => b.type === 'title_update')).toBe(false);
  });
});
