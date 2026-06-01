import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../../src/env';
import { agentConfigDirFor } from '../../src/services/agent/agent-paths';

// `syncTranscript` is the only DB-touching export under test here; everything
// else (encodeCwd, transcriptPath, …) is pure. Mock the `db` singleton BEFORE
// importing the module so the real (lazy) postgres client is never touched. The
// mock captures the single insert(...).onConflictDoUpdate({set}) write into
// `written`; syncTranscript passes the same content/byteOffset to both, so `set`
// is the committed row.
let written: {
  content: string;
  byteOffset: number;
  sdkSessionId: string;
  workspaceCwd: string;
} | null = null;
const dbMock = () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async ({ set }: { set: NonNullable<typeof written> }) => {
          written = set;
        },
      }),
    }),
  },
  schema: {},
});
mock.module('../../src/db', dbMock);
mock.module('../../src/db/index', dbMock);

// Imported after the mock so the module graph binds to the fake db.
const {
  aiTitleFromJsonl,
  encodeCwd,
  firstUserTextFromJsonl,
  MAX_ENCODED_LEN,
  projectTranscriptDir,
  subagentDir,
  syncTranscript,
  transcriptPath,
} = await import('../../src/services/agent/transcript-store');

// Paths are now per-user: `<AGENT_STATE_ROOT>/<userSlug>/projects/<enc(cwd)>`.
// `agentConfigDirFor(cwd)` derives the per-user config dir from the cwd's first
// segment under WORKSPACE_ROOT, so test cwds must live under it (setup.ts sets
// WORKSPACE_ROOT=/tmp/mtc-webui-test). We assert the composed structure derived
// from env, not the host.
const WS = env.WORKSPACE_ROOT;
const projectsRoot = (cwd: string) => join(agentConfigDirFor(cwd), 'projects');

describe('encodeCwd', () => {
  it('preserves alphanumeric characters unchanged', () => {
    expect(encodeCwd('abcXYZ0123456789')).toBe('abcXYZ0123456789');
  });

  it('replaces "/" with "-" (one per char)', () => {
    expect(encodeCwd('/a/b/c')).toBe('-a-b-c');
  });

  it('replaces "." with "-"', () => {
    expect(encodeCwd('a.b.c')).toBe('a-b-c');
  });

  it('replaces space with "-"', () => {
    expect(encodeCwd('a b c')).toBe('a-b-c');
  });

  it('replaces a unicode char with a single "-"', () => {
    expect(encodeCwd('café')).toBe('caf-');
    expect(encodeCwd('naïve')).toBe('na-ve');
  });

  it('maps every non-alphanumeric char 1:1 — no dash collapsing, length preserved', () => {
    const input = '/a//b..c  d';
    const encoded = encodeCwd(input);
    expect(encoded).toBe('-a--b--c--d');
    expect(encoded.length).toBe(input.length);
  });

  it('does not collapse a run of separators', () => {
    expect(encodeCwd('___')).toBe('---');
    expect(encodeCwd('a---b')).toBe('a---b'); // hyphens are themselves non-alnum
  });

  it('encodes a realistic workspace path correctly', () => {
    expect(encodeCwd('/data/workspace/user-slug/my-project')).toBe(
      '-data-workspace-user-slug-my-project',
    );
  });

  it('preserves length for ASCII non-alphanumerics (1:1 byte mapping)', () => {
    const input = '/data/workspace/user-slug/my-project';
    expect(encodeCwd(input).length).toBe(input.length);
  });

  it('exports MAX_ENCODED_LEN = 200', () => {
    expect(MAX_ENCODED_LEN).toBe(200);
  });
});

describe('transcriptPath', () => {
  it('composes <per-user projects>/<enc(cwd)>/<id>.jsonl', () => {
    const cwd = join(WS, 'dan.le', 'my-project');
    const id = '11111111-2222-3333-4444-555555555555';
    expect(transcriptPath(cwd, id)).toBe(join(projectsRoot(cwd), encodeCwd(cwd), `${id}.jsonl`));
  });

  it('roots the projects dir under the per-user agent-state config dir', () => {
    const cwd = join(WS, 'dan.le', 'my-project');
    expect(transcriptPath(cwd, 'sess-1').startsWith(join(agentConfigDirFor(cwd), 'projects'))).toBe(
      true,
    );
  });
});

describe('subagentDir', () => {
  it('composes <per-user projects>/<enc(cwd)>/<id>/subagents', () => {
    const cwd = join(WS, 'dan.le', 'my-project');
    const id = '11111111-2222-3333-4444-555555555555';
    expect(subagentDir(cwd, id)).toBe(join(projectsRoot(cwd), encodeCwd(cwd), id, 'subagents'));
  });

  it('nests under the same encoded project dir as the transcript', () => {
    const cwd = join(WS, 'dan.le', 'proj');
    const id = 'sess-1';
    expect(subagentDir(cwd, id)).toBe(join(projectsRoot(cwd), encodeCwd(cwd), id, 'subagents'));
  });
});

describe('per-user separation', () => {
  it('routes two users to distinct project trees', () => {
    const cwdA = join(WS, 'dan.le', 'proj');
    const cwdB = join(WS, 'chau', 'proj');
    const a = transcriptPath(cwdA, 'sess');
    const b = transcriptPath(cwdB, 'sess');
    expect(a).not.toBe(b);
    expect(a.startsWith(agentConfigDirFor(cwdA))).toBe(true);
    expect(b.startsWith(agentConfigDirFor(cwdB))).toBe(true);
    // The two config dirs differ only by their trailing user-slug segment.
    expect(agentConfigDirFor(cwdA)).not.toBe(agentConfigDirFor(cwdB));
  });

  it('projectTranscriptDir is under the cwd-owning user config dir', () => {
    const cwd = join(WS, 'chau', 'repo');
    expect(projectTranscriptDir(cwd)).toBe(
      join(agentConfigDirFor(cwd), 'projects', encodeCwd(cwd)),
    );
  });
});

describe('aiTitleFromJsonl', () => {
  const titleLine = (aiTitle: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'ai-title', aiTitle, sessionId: 's1', ...extra });
  const userLine = (content: string) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content } });

  it('returns the aiTitle of a single ai-title entry', () => {
    const jsonl = [userLine('what is the cwd?'), titleLine('Find current project directory')].join(
      '\n',
    );
    expect(aiTitleFromJsonl(jsonl)).toBe('Find current project directory');
  });

  it('returns the LAST ai-title when several are present (last-wins)', () => {
    const jsonl = [
      titleLine('First guess'),
      userLine('more context'),
      titleLine('Refined title'),
    ].join('\n');
    expect(aiTitleFromJsonl(jsonl)).toBe('Refined title');
  });

  it('trims surrounding whitespace', () => {
    expect(aiTitleFromJsonl(titleLine('  Add OAuth login  '))).toBe('Add OAuth login');
  });

  it('skips non-string / empty aiTitle and tolerates malformed lines', () => {
    const jsonl = ['not json', titleLine(42), titleLine('   '), titleLine('the real title')].join(
      '\n',
    );
    expect(aiTitleFromJsonl(jsonl)).toBe('the real title');
  });

  it('returns null when there is no ai-title entry', () => {
    expect(aiTitleFromJsonl([userLine('hi'), 'garbage'].join('\n'))).toBeNull();
    expect(aiTitleFromJsonl('')).toBeNull();
  });
});

describe('firstUserTextFromJsonl', () => {
  const userLine = (content: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
  const asstLine = (text: string) =>
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    });

  it('returns the first user message (string content)', () => {
    const jsonl = [userLine('Xin chào'), asstLine('hi back')].join('\n');
    expect(firstUserTextFromJsonl(jsonl)).toBe('Xin chào');
  });

  it('joins text blocks of an array-content user message', () => {
    const jsonl = userLine([
      { type: 'text', text: 'fix the ' },
      { type: 'text', text: 'login bug' },
    ]);
    expect(firstUserTextFromJsonl(jsonl)).toBe('fix the login bug');
  });

  it('skips isMeta entries and tool_result-only turns, returns the first real prompt', () => {
    const jsonl = [
      userLine('system context', { isMeta: true }),
      userLine([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      userLine('the real first prompt'),
    ].join('\n');
    expect(firstUserTextFromJsonl(jsonl)).toBe('the real first prompt');
  });

  it('returns the FIRST (not last) user prompt and tolerates malformed lines', () => {
    const jsonl = ['not json', userLine('hello'), userLine('second')].join('\n');
    expect(firstUserTextFromJsonl(jsonl)).toBe('hello');
  });

  it('returns null when there is no user text', () => {
    expect(firstUserTextFromJsonl([asstLine('only assistant')].join('\n'))).toBeNull();
    expect(firstUserTextFromJsonl('')).toBeNull();
  });
});

describe('syncTranscript', () => {
  // Real on-disk JSONL under a per-test cwd; each test cleans up after itself.
  let seq = 0;
  const dirs: string[] = [];

  /** Write `content` to the transcript path for a fresh cwd + sdkSessionId. */
  async function setupFile(content: string): Promise<{
    cwd: string;
    sdkSessionId: string;
    path: string;
  }> {
    seq += 1;
    const cwd = join(WS, 'dan.le', `sync-test-${seq}`);
    const sdkSessionId = `sdk-${seq}`;
    const path = transcriptPath(cwd, sdkSessionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    dirs.push(join(projectsRoot(cwd), encodeCwd(cwd)));
    return { cwd, sdkSessionId, path };
  }

  const asstLine = (id: string, block: Record<string, unknown>) =>
    JSON.stringify({ type: 'assistant', message: { id, content: [block] } });
  const userLine = (content: string) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content } });

  beforeEach(() => {
    written = null;
  });

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it('overwrites content verbatim and sets byteOffset to the file BYTE length', async () => {
    // Vietnamese prompt → byteLength != length, so a char-length offset would be
    // wrong. The DB content must byte-equal the file.
    const content = [
      userLine('Sửa lỗi đăng nhập'),
      asstLine('msg_1', { type: 'text', text: 'ok' }),
    ].join('\n');
    const { cwd, sdkSessionId } = await setupFile(content);

    await syncTranscript('s1', sdkSessionId, cwd);

    expect(written?.content).toBe(content);
    expect(written?.byteOffset).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(written?.byteOffset).not.toBe(content.length); // multi-byte proves bytes, not chars
    expect(written?.sdkSessionId).toBe(sdkSessionId);
    expect(written?.workspaceCwd).toBe(cwd);
  });

  it('fully overwrites on fork/truncate — no stale tail from the longer prior content', async () => {
    const a = asstLine('msg_A', { type: 'text', text: 'first' });
    const b = asstLine('msg_B', { type: 'text', text: 'second' });
    const c = asstLine('msg_C', { type: 'text', text: 'STALE-TAIL-MARKER' });
    const long = [a, b, c].join('\n');
    const { cwd, sdkSessionId, path } = await setupFile(long);

    await syncTranscript('s1', sdkSessionId, cwd);
    expect(written?.content).toBe(long);

    // File replaced by SHORTER content (fork/resume rewrote it).
    await writeFile(path, a);
    await syncTranscript('s1', sdkSessionId, cwd);

    expect(written?.content).toBe(a);
    expect(written?.content.includes('STALE-TAIL-MARKER')).toBe(false);
    expect(written?.byteOffset).toBe(Buffer.byteLength(a, 'utf-8'));
  });

  it('skips a missing file without writing or throwing', async () => {
    const cwd = join(WS, 'dan.le', `sync-missing-${seq + 100}`);
    await syncTranscript('s1', 'no-such-session', cwd);
    expect(written).toBeNull();
  });

  it('barrier waits for the tail block to land, then writes the full content', async () => {
    // The bug scenario: at `result`, the file only has the thinking line of the
    // last assistant message (1 block) but the anchor expects 2 (thinking+text).
    // The barrier must NOT stop at 1 — it polls until the text line is on disk.
    const id = 'msg_TAIL';
    const thinking = asstLine(id, { type: 'thinking', thinking: 'reason', signature: '' });
    const text = asstLine(id, { type: 'text', text: 'the answer' });
    const { cwd, sdkSessionId, path } = await setupFile(thinking); // 1 block on disk

    // The subprocess flushes the tail line a beat later, mid-poll.
    setTimeout(() => {
      void writeFile(path, `${thinking}\n${text}`);
    }, 40);

    await syncTranscript('s-tail', sdkSessionId, cwd, {
      awaitMessageId: id,
      awaitBlocks: 2,
      pollIntervalMs: 10,
      maxPolls: 100,
    });

    expect(written?.content).toBe(`${thinking}\n${text}`);
    expect(written?.content.includes('reason')).toBe(true); // thinking kept
    expect(written?.content.includes('the answer')).toBe(true); // tail not cut
  });

  it('does not stop early on a same-id line that lacks the tail block', async () => {
    // File has only the thinking line for the id; the tail never lands. The
    // barrier counts BLOCKS (1), not the mere presence of the id, so it polls to
    // the timeout instead of committing the half-message.
    const id = 'msg_PARTIAL';
    const thinking = asstLine(id, { type: 'thinking', thinking: 'reason', signature: '' });
    const { cwd, sdkSessionId } = await setupFile(thinking);

    await syncTranscript('s-partial', sdkSessionId, cwd, {
      awaitMessageId: id,
      awaitBlocks: 2,
      pollIntervalMs: 5,
      maxPolls: 3,
    });

    // Best-effort: it still wrote the content it had (1 block), never threw.
    expect(written?.content).toBe(thinking);
  });

  it('barrier timeout writes best-effort current content and never throws', async () => {
    const id = 'msg_TO';
    const onlyThinking = asstLine(id, { type: 'thinking', thinking: 'reason', signature: '' });
    const { cwd, sdkSessionId } = await setupFile(onlyThinking);

    await expect(
      syncTranscript('s-to', sdkSessionId, cwd, {
        awaitMessageId: id,
        awaitBlocks: 5, // never reached
        pollIntervalMs: 5,
        maxPolls: 3,
      }),
    ).resolves.toBeUndefined();

    expect(written?.content).toBe(onlyThinking);
  });

  it('no anchor (null awaitMessageId) reads and writes immediately', async () => {
    const content = asstLine('msg_NA', { type: 'text', text: 'done' });
    const { cwd, sdkSessionId } = await setupFile(content);

    await syncTranscript('s-na', sdkSessionId, cwd, { awaitMessageId: null, awaitBlocks: 0 });

    expect(written?.content).toBe(content);
  });
});
