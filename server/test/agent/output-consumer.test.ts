import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Block } from 'shared/types';
import type { ActiveSession } from '../../src/services/session-manager';

// The consumer's only external emit path is broadcastEvent — capture it.
type Broadcast = { type: string; payload: Record<string, unknown> };
const broadcasts: Broadcast[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload: (payload ?? {}) as Record<string, unknown> });
    return { type, payload };
  },
}));

// In-memory DB stand-in. The round-trip tests run REAL syncTranscript (reads the
// on-disk JSONL, overwrites content); this captures that write into
// `storedContent` and serves it back for any read. Title stays `manual` so
// `maybePersistTitle` short-circuits — keeps these tests about the transcript.
let storedContent: string | null = null;
// Captures the latest `subagents` jsonb map written via `db.update().set(...)`
// (backupSubagents). Other updates (usage/title) carry no `subagents` key and
// are ignored, so this only reflects subagent backups.
let storedSubagents: Record<string, string> | null = null;
const dbFactory = () => ({
  db: {
    query: {
      sessions: { findFirst: async () => ({ title: 'preset', titleSource: 'manual' }) },
      sessionTranscripts: {
        findFirst: async () => (storedContent == null ? undefined : { content: storedContent }),
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async ({ set }: { set: { content: string } }) => {
          storedContent = set.content;
        },
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        if (vals && 'subagents' in vals) {
          storedSubagents = vals.subagents as Record<string, string> | null;
        }
        return { where: async () => {} };
      },
    }),
  },
  schema: { sessions: {}, sessionTranscripts: {} },
});
mock.module('../../src/db', dbFactory);
mock.module('../../src/db/index', dbFactory);

const { consumeQueryOutput } = await import('../../src/services/agent/output-consumer');
const { SessionManager } = await import('../../src/services/session-manager');
const { transcriptPath, subagentDir } = await import('../../src/services/agent/transcript-store');
const { renderTranscript } = await import('../../src/services/agent/transcript-render');
const { env } = await import('../../src/env');

const WS = env.WORKSPACE_ROOT;

/** An async-iterable query that just replays a fixed message list. */
function makeQuery(messages: unknown[]): ActiveSession['query'] {
  return (async function* () {
    for (const m of messages) yield m;
  })() as unknown as ActiveSession['query'];
}

describe('consumeQueryOutput — assistant content-block id parity', () => {
  it('assigns CUMULATIVE block ids across same-message-id split messages', async () => {
    // Verified via live SDK probe: the SDK emits each content block as its OWN
    // length-1 `assistant` message; consecutive blocks share one message.id and
    // the true block index is the order within that same-id group. Messages carry
    // no session_id so captureSessionId stays a no-op (no DB / transcript writes).
    broadcasts.length = 0;
    const sm = new SessionManager();
    const active = sm.register({
      sessionId: 's1',
      userId: 'u1',
      workDir: '/tmp/w',
      approvalMode: 'ask',
    });
    const A = 'msg_AAA';
    const B = 'msg_BBB';
    active.query = makeQuery([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: A, content: [{ type: 'thinking', thinking: 'reason', signature: '' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: A, content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: A,
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } },
          ],
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: B, content: [{ type: 'thinking', thinking: 'more', signature: '' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: B, content: [{ type: 'text', text: 'final' }] },
      },
    ]);

    await consumeQueryOutput(active);

    // Block ids increment per content block within a message.id and reset on a new
    // id — matching the streaming event.index and the reload renderer. The old bug
    // used the (always-0) array-local index, so text collided onto `${A}:0`.
    expect(
      broadcasts.map((b) => ({ type: b.type, id: b.payload.id, final: b.payload.final })),
    ).toEqual([
      { type: 'thinking_delta', id: `${A}:0`, final: true },
      { type: 'text_delta', id: `${A}:1`, final: true },
      { type: 'tool_call', id: 'toolu_1', final: undefined },
      { type: 'thinking_delta', id: `${B}:0`, final: true },
      { type: 'text_delta', id: `${B}:1`, final: true },
    ]);
  });
});

describe('consumeQueryOutput — transcript backup round-trip', () => {
  // ── A realistic turn: user → assistant(thinking+text+tool_use) → tool_result →
  //    assistant(thinking+text) → result. The SDK splits each content block onto
  //    its own length-1 assistant message; the on-disk JSONL mirrors that, one
  //    line per block. The LAST main assistant message is `msg_S` with 2 blocks,
  //    so the end-of-turn flush barrier anchors on {msg_S, 2}.
  const sdkMessages: unknown[] = [
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: 'run echo hi' } },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg_R',
        content: [{ type: 'thinking', thinking: 'plan it', signature: 'sig' }],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: 'msg_R', content: [{ type: 'text', text: 'Running echo' }] },
    },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg_R',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }],
      },
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi\n', is_error: false },
        ],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg_S',
        content: [{ type: 'thinking', thinking: 'done thinking', signature: 'sig2' }],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: 'msg_S', content: [{ type: 'text', text: 'Output was hi' }] },
    },
    {
      type: 'result',
      subtype: 'success',
      num_turns: 1,
      usage: { input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0.01,
    },
  ];

  // The on-disk JSONL the subprocess wrote — one line per content block, in order.
  const jsonlLines = [
    JSON.stringify({
      type: 'user',
      uuid: 'u-1',
      message: { role: 'user', content: 'run echo hi' },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_R',
        content: [{ type: 'thinking', thinking: 'plan it', signature: 'sig' }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_R', content: [{ type: 'text', text: 'Running echo' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_R',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }],
      },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'u-2',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi\n', is_error: false },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_S',
        content: [{ type: 'thinking', thinking: 'done thinking', signature: 'sig2' }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_S', content: [{ type: 'text', text: 'Output was hi' }] },
    }),
  ];

  // What the live consumer emits, reduced to {kind, id, content}. The user prompt
  // is NOT a live block (the client renders it from turn_begin), so the renderer's
  // user block is excluded from the comparison.
  type Norm = { kind: string; id: string; content: unknown };
  function normalizeLive(bs: Broadcast[]): Norm[] {
    const out: Norm[] = [];
    for (const b of bs) {
      const p = b.payload;
      if (b.type === 'thinking_delta' && p.final)
        out.push({ kind: 'thinking', id: String(p.id), content: p.thinking });
      else if (b.type === 'text_delta' && p.final)
        out.push({ kind: 'text', id: String(p.id), content: p.text });
      else if (b.type === 'tool_call')
        out.push({ kind: 'tool_call', id: String(p.id), content: p.name });
      else if (b.type === 'tool_result')
        out.push({ kind: 'tool_result', id: String(p.toolCallId), content: p.output });
    }
    return out;
  }
  function normalizeRendered(blocks: Block[]): Norm[] {
    const out: Norm[] = [];
    for (const b of blocks) {
      if (b.kind === 'thinking') out.push({ kind: 'thinking', id: b.id, content: b.content });
      else if (b.kind === 'text') out.push({ kind: 'text', id: b.id, content: b.content });
      else if (b.kind === 'tool_call') out.push({ kind: 'tool_call', id: b.id, content: b.name });
      else if (b.kind === 'tool_result')
        out.push({ kind: 'tool_result', id: b.id, content: b.output });
      // 'user' (the prompt bubble) is intentionally dropped — see above.
    }
    return out;
  }

  let seq = 0;
  const dirs: string[] = [];

  function makeSession(): { active: ActiveSession; path: string } {
    seq += 1;
    const sm = new SessionManager();
    const cwd = join(WS, 'dan.le', `rt-test-${seq}`);
    const sdkSessionId = `sdk-rt-${seq}`;
    const active = sm.register({
      sessionId: `s-${seq}`,
      userId: 'u1',
      workDir: cwd,
      approvalMode: 'ask',
    });
    active.sdkSessionId = sdkSessionId; // pre-set so capture is a no-op
    const path = transcriptPath(cwd, sdkSessionId);
    dirs.push(dirname(path));
    return { active, path };
  }

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
    storedContent = null;
  });

  it('db === file (byte-equal) and renderTranscript(DB) matches the live block set', async () => {
    broadcasts.length = 0;
    storedContent = null;
    const { active, path } = makeSession();
    const fileContent = jsonlLines.join('\n');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, fileContent);

    active.query = makeQuery(sdkMessages);
    await consumeQueryOutput(active);

    // db === file: the DB content byte-equals the on-disk JSONL.
    expect(storedContent as string | null).toBe(fileContent);
    expect(Buffer.byteLength(storedContent ?? '', 'utf-8')).toBe(
      Buffer.byteLength(fileContent, 'utf-8'),
    );

    // Reload renders the SAME blocks (by id + kind + content) the live path emitted.
    const rendered = renderTranscript(storedContent ?? '');
    expect(normalizeRendered(rendered)).toEqual(normalizeLive(broadcasts));
    // The reload also carries the user prompt bubble the live stream omits.
    expect(rendered.some((b) => b.kind === 'user' && b.content === 'run echo hi')).toBe(true);
  });

  it('flush barrier keeps the tail: thinking + text of the last message survive', async () => {
    // The bug: at `result`, the file only has the THINKING line of msg_S (1 block)
    // but the live consumer saw 2 blocks (anchor {msg_S, 2}). The barrier must not
    // commit the half-message — it polls until the text line lands on disk.
    broadcasts.length = 0;
    storedContent = null;
    const { active, path } = makeSession();
    const fullContent = jsonlLines.join('\n');
    const partialContent = jsonlLines.slice(0, -1).join('\n'); // missing msg_S text line
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, partialContent);

    // The subprocess flushes the tail text line a beat after `result` is seen.
    setTimeout(() => {
      void writeFile(path, fullContent);
    }, 40);

    active.query = makeQuery(sdkMessages);
    await consumeQueryOutput(active);

    // Barrier waited → committed content includes the tail text line.
    expect(storedContent as string | null).toBe(fullContent);
    const rendered = renderTranscript(storedContent ?? '');
    expect(rendered.some((b) => b.kind === 'thinking' && b.id === 'msg_S:0')).toBe(true);
    expect(
      rendered.some(
        (b) => b.kind === 'text' && b.id === 'msg_S:1' && b.content === 'Output was hi',
      ),
    ).toBe(true);
    expect(normalizeRendered(rendered)).toEqual(normalizeLive(broadcasts));
  });
});

describe('consumeQueryOutput — mid-turn subagent backup', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
    storedContent = null;
    storedSubagents = null;
  });

  it('flushes subagents to the DB on a subagent message — before any turn-end result', async () => {
    // Repro of the F5-mid-turn bug: while a subagent streams, the main agent is
    // parked on the Task tool, so no main assistant message (and thus no
    // syncTranscript) fires, and the turn-end `result` has not arrived yet. The
    // subagent JSONL is on disk but, pre-fix, was only backed up at turn end — a
    // reload built its snapshot from a NULL `subagents` column and lost it all.
    broadcasts.length = 0;
    storedContent = null;
    storedSubagents = null;

    const sm = new SessionManager();
    const cwd = join(WS, 'dan.le', 'sub-mid-turn');
    const sdkSessionId = 'sdk-sub-1';
    const active = sm.register({
      sessionId: 's-sub-1',
      userId: 'u1',
      workDir: cwd,
      approvalMode: 'ask',
    });
    active.sdkSessionId = sdkSessionId; // pre-set so capture is a no-op

    // The subprocess has already written the subagent's transcript + meta on disk.
    const dir = subagentDir(cwd, sdkSessionId);
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    const agentJsonl = JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_sub', content: [{ type: 'text', text: 'subagent searching' }] },
    });
    await writeFile(join(dir, 'agent-aaa.jsonl'), agentJsonl);
    await writeFile(
      join(dir, 'agent-aaa.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'find it', toolUseId: 'call_sub' }),
    );

    // A single subagent assistant message (parent_tool_use_id !== null) and NO
    // `result` — i.e. the turn is still in flight when the user reloads.
    active.query = makeQuery([
      {
        type: 'assistant',
        parent_tool_use_id: 'call_sub',
        message: { id: 'msg_sub', content: [{ type: 'text', text: 'subagent searching' }] },
      },
    ]);

    await consumeQueryOutput(active);
    await active.backupMutex; // drain the chained, fire-and-forget backup

    // The subagent column is populated mid-turn — no turn-end result needed.
    const saved = storedSubagents as Record<string, string> | null;
    expect(saved).not.toBeNull();
    expect(Object.keys(saved ?? {}).sort()).toEqual(['agent-aaa.jsonl', 'agent-aaa.meta.json']);
    expect(saved?.['agent-aaa.jsonl']).toBe(agentJsonl);
  });
});
