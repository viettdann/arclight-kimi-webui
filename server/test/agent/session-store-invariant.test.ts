import type { SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  createSessionStore,
  deleteStoreEntries,
  readSessionEntries,
} from '../../src/services/agent/session-store';
import { renderEntries, renderTranscript } from '../../src/services/agent/transcript-render';
import { makePgDb, type PgHandle } from '../_helpers-pg';

// The migration's CORE INVARIANT: what the AI sees (the local JSONL the binary
// wrote) and what the user sees (the snapshot rendered from the DB store) never
// diverge. These tests exercise the real Postgres-backed store on an in-process
// pglite engine — the same SQL the production `db` runs — through the actual
// render path, so the round-trip is held to byte-for-render fidelity.

let pg: PgHandle;
let store: SessionStore;

beforeAll(async () => {
  pg = await makePgDb();
  store = createSessionStore(pg.db);
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.db.execute(sql`TRUNCATE session_store_entries RESTART IDENTITY`);
});

// ─────────────────────────── Shared fixture ───────────────────────────
//
// One realistic turn: user → assistant(thinking + text + Task tool_use) →
// tool_result(Task) → assistant(text). The Task spawned one Explore subagent.
// The SDK splits each assistant content block onto its own frame, mirrored here
// as one store entry each — exactly the on-disk JSONL shape.

const PK = '-tmp-mtc-webui-test-proj';
const SID = 'sdk-inv-main';
const SUBPATH = 'subagents/agent-aXYZ';

const main: SessionStoreEntry[] = [
  { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'tìm chỗ định nghĩa logger' } },
  {
    type: 'assistant',
    message: { id: 'msg_R', content: [{ type: 'thinking', thinking: 'lên kế hoạch', signature: 'sig' }] },
  },
  { type: 'assistant', message: { id: 'msg_R', content: [{ type: 'text', text: 'Spawning a search' }] } },
  {
    type: 'assistant',
    message: {
      id: 'msg_R',
      content: [
        { type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'find logger', subagent_type: 'Explore' } },
      ],
    },
  },
  {
    type: 'user',
    uuid: 'u-2',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'done', is_error: false }],
    },
    toolUseResult: { agentId: 'aXYZ', status: 'completed' },
  },
  {
    type: 'assistant',
    message: { id: 'msg_S', content: [{ type: 'text', text: 'Logger ở server/src/lib/logger.ts' }] },
  },
];

const subMeta = { toolUseId: 'toolu_task', agentType: 'Explore', description: 'find logger' };
const subTranscript: SessionStoreEntry[] = [
  { type: 'user', uuid: 'sa-1', isSidechain: true, message: { role: 'user', content: 'find the logger' } },
  {
    type: 'assistant',
    isSidechain: true,
    message: { id: 'msg_SA', content: [{ type: 'text', text: 'found it' }] },
  },
];
// The SDK mirrors a subagent's `.meta.json` sidecar as a single
// `{type:'agent_metadata', ...meta}` entry under the same subpath.
const subEntries: SessionStoreEntry[] = [{ type: 'agent_metadata', ...subMeta }, ...subTranscript];

// The equivalent on-disk JSONL the binary writes — the "AI view".
const mainJsonl = main.map((e) => JSON.stringify(e)).join('\n');
const subFiles: Record<string, string> = {
  'agent-aXYZ.jsonl': subTranscript.map((e) => JSON.stringify(e)).join('\n'),
  'agent-aXYZ.meta.json': JSON.stringify(subMeta),
};

/** Deep key-sort so a jsonb round-trip (Postgres reorders object keys) compares
 *  structurally, not by serialization order. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = canon((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}

describe('session-store invariant — AI view == user view', () => {
  it('store render === jsonl render for both live and terminal flags', async () => {
    await store.append({ projectKey: PK, sessionId: SID }, main);
    await store.append({ projectKey: PK, sessionId: SID, subpath: SUBPATH }, subEntries);

    const { main: m, subagents } = await readSessionEntries(pg.db, SID);

    // The render from the DB store (what the user sees on reload) is identical to
    // the render from the on-disk JSONL (what the AI saw while running) — under
    // BOTH the live-reconcile and terminal-snapshot render modes.
    for (const terminal of [false, true]) {
      const fromStore = renderEntries(m, subagents, { terminal });
      const fromJsonl = renderTranscript(mainJsonl, subFiles, { terminal });
      expect(fromStore).toEqual(fromJsonl);
    }

    // And it's a non-trivial transcript: the subagent nested under its Task.
    const sa = renderEntries(m, subagents, { terminal: true }).find((b) => b.kind === 'subagent');
    expect(sa?.id).toBe('subagent:toolu_task');
  });

  it('interrupted turn: terminal synthesis from the store matches the jsonl', async () => {
    // A turn killed mid-flight: the Task tool_use never got a tool_result, and the
    // subagent was cut while a Grep was running (no inner result). The terminal
    // snapshot must synthesize interrupted markers identically from either source.
    const interruptedMain: SessionStoreEntry[] = [
      { type: 'user', uuid: 'iu-1', message: { role: 'user', content: 'explore' } },
      {
        type: 'assistant',
        message: {
          id: 'msg_M',
          content: [
            { type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'explore', subagent_type: 'Explore' } },
          ],
        },
      },
    ];
    const interruptedSubMeta = { toolUseId: 'toolu_task', agentType: 'Explore', description: 'explore' };
    const interruptedSubTranscript: SessionStoreEntry[] = [
      {
        type: 'assistant',
        isSidechain: true,
        message: { id: 'msg_SA', content: [{ type: 'text', text: 'searching' }] },
      },
      {
        type: 'assistant',
        isSidechain: true,
        message: {
          id: 'msg_SA',
          content: [{ type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'foo' } }],
        },
      },
    ];
    const interruptedSubEntries: SessionStoreEntry[] = [
      { type: 'agent_metadata', ...interruptedSubMeta },
      ...interruptedSubTranscript,
    ];

    await store.append({ projectKey: PK, sessionId: SID }, interruptedMain);
    await store.append({ projectKey: PK, sessionId: SID, subpath: SUBPATH }, interruptedSubEntries);

    const { main: m, subagents } = await readSessionEntries(pg.db, SID);
    const fromStore = renderEntries(m, subagents, { terminal: true });

    const fromJsonl = renderTranscript(
      interruptedMain.map((e) => JSON.stringify(e)).join('\n'),
      {
        'agent-aXYZ.jsonl': interruptedSubTranscript.map((e) => JSON.stringify(e)).join('\n'),
        'agent-aXYZ.meta.json': JSON.stringify(interruptedSubMeta),
      },
      { terminal: true },
    );

    expect(fromStore).toEqual(fromJsonl);

    // The Task and the dangling inner Grep both got synthetic interrupted results.
    const taskResult = fromStore.find((b) => b.kind === 'tool_result' && b.toolCallId === 'toolu_task');
    expect(taskResult && 'synthetic' in taskResult ? taskResult.synthetic : undefined).toBe(
      'interrupted',
    );
    const sa = fromStore.find((b) => b.kind === 'subagent');
    const innerResult =
      sa?.kind === 'subagent'
        ? sa.blocks.find((b) => b.kind === 'tool_result' && b.toolCallId === 'toolu_grep')
        : undefined;
    expect(innerResult && 'synthetic' in innerResult ? innerResult.synthetic : undefined).toBe(
      'interrupted',
    );
  });
});

describe('session-store invariant — DB is the resume source of truth', () => {
  it('load() rematerializes the appended entries in append order', async () => {
    await store.append({ projectKey: PK, sessionId: SID }, main);
    const loaded = await store.load({ projectKey: PK, sessionId: SID });
    expect(loaded).not.toBeNull();
    expect(canon(loaded)).toEqual(canon(main));
  });

  it('a subpath load is scoped to that subagent; the main load excludes it', async () => {
    await store.append({ projectKey: PK, sessionId: SID }, main);
    await store.append({ projectKey: PK, sessionId: SID, subpath: SUBPATH }, subEntries);

    const sub = await store.load({ projectKey: PK, sessionId: SID, subpath: SUBPATH });
    expect(canon(sub)).toEqual(canon(subEntries));

    // The main transcript load is unaffected by the subagent rows.
    const mainAgain = await store.load({ projectKey: PK, sessionId: SID });
    expect(canon(mainAgain)).toEqual(canon(main));
  });

  it('load() returns null for an unknown session', async () => {
    expect(await store.load({ projectKey: PK, sessionId: 'no-such' })).toBeNull();
  });

  it('re-append of a uuid-bearing batch does not duplicate (mirror retry is safe)', async () => {
    const entries: SessionStoreEntry[] = [
      { type: 'user', uuid: 'dup-1', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', uuid: 'dup-2', message: { id: 'm', content: [{ type: 'text', text: 'yo' }] } },
    ];
    await store.append({ projectKey: PK, sessionId: SID }, entries);
    await store.append({ projectKey: PK, sessionId: SID }, entries); // the SDK retried the batch
    const loaded = await store.load({ projectKey: PK, sessionId: SID });
    expect(loaded?.length).toBe(2);
  });
});

describe('session-store invariant — delete cleanup', () => {
  it('deleteStoreEntries removes a session entirely, leaving siblings intact', async () => {
    await store.append({ projectKey: PK, sessionId: SID }, main);
    await store.append({ projectKey: PK, sessionId: SID, subpath: SUBPATH }, subEntries);
    const other = 'sdk-inv-other';
    await store.append({ projectKey: PK, sessionId: other }, [
      { type: 'user', uuid: 'o-1', message: { role: 'user', content: 'keep me' } },
    ]);

    await deleteStoreEntries(pg.db, [SID]);

    const gone = await readSessionEntries(pg.db, SID);
    expect(gone.main).toEqual([]);
    expect(gone.subagents.size).toBe(0);

    // The sibling session is untouched.
    const kept = await readSessionEntries(pg.db, other);
    expect(kept.main.length).toBe(1);
  });

  it('deleteStoreEntries is a no-op for an empty id list', async () => {
    await store.append({ projectKey: PK, sessionId: SID }, main);
    await deleteStoreEntries(pg.db, []);
    const still = await readSessionEntries(pg.db, SID);
    expect(still.main.length).toBe(main.length);
  });
});
