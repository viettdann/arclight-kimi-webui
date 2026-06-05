import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../../src/env';
import { agentConfigDirFor } from '../../src/services/agent/agent-paths';
import {
  aiTitleFromJsonl,
  clearLocalSession,
  encodeCwd,
  firstUserTextFromJsonl,
  MAX_ENCODED_LEN,
  projectTranscriptDir,
  readTranscriptTitleInputs,
  subagentDir,
  transcriptPath,
} from '../../src/services/agent/transcript-store';

// The module is now db-free: every export reads either pure strings
// (encodeCwd / *FromJsonl) or the local JSONL on disk (clearLocalSession /
// readTranscriptTitleInputs). No db mock needed — the SDK store owns DB
// persistence.

// Paths are per-user: `<AGENT_STATE_ROOT>/<userSlug>/projects/<enc(cwd)>`.
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
    const jsonl = [userLine('Hello'), asstLine('hi back')].join('\n');
    expect(firstUserTextFromJsonl(jsonl)).toBe('Hello');
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

describe('clearLocalSession', () => {
  // Real on-disk scratch under a per-test cwd; each test cleans up after itself.
  let seq = 0;
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it('removes the main jsonl and the session subtree, leaving sibling sessions', async () => {
    seq += 1;
    const cwd = join(WS, 'dan.le', `clear-test-${seq}`);
    const id = `sdk-${seq}`;
    const sibling = `sdk-${seq}-other`;
    dirs.push(projectTranscriptDir(cwd));

    // The session under deletion: its main jsonl + a subagent transcript.
    const jsonl = transcriptPath(cwd, id);
    await mkdir(dirname(jsonl), { recursive: true });
    await writeFile(jsonl, '{"type":"user"}');
    const subFile = join(subagentDir(cwd, id), 'agent-x.jsonl');
    await mkdir(dirname(subFile), { recursive: true });
    await writeFile(subFile, '{"type":"assistant"}');

    // A sibling session under the SAME cwd must survive the targeted clear.
    const siblingJsonl = transcriptPath(cwd, sibling);
    await writeFile(siblingJsonl, '{"type":"user"}');

    await clearLocalSession(cwd, id);

    expect(await Bun.file(jsonl).exists()).toBe(false);
    expect(await Bun.file(subFile).exists()).toBe(false);
    expect(await Bun.file(siblingJsonl).exists()).toBe(true);
  });

  it('is a no-op on a missing session (never throws)', async () => {
    const cwd = join(WS, 'dan.le', `clear-missing-${seq + 100}`);
    await expect(clearLocalSession(cwd, 'no-such')).resolves.toBeUndefined();
  });
});

describe('readTranscriptTitleInputs', () => {
  let seq = 0;
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it('parses ai-title (last-wins) and first user text from the local jsonl', async () => {
    seq += 1;
    const cwd = join(WS, 'dan.le', `title-test-${seq}`);
    const id = `sdk-title-${seq}`;
    dirs.push(projectTranscriptDir(cwd));
    const jsonl = transcriptPath(cwd, id);
    await mkdir(dirname(jsonl), { recursive: true });
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix login bug' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Fix login bug', sessionId: id }),
    ];
    await writeFile(jsonl, lines.join('\n'));

    const { aiTitle, firstUserText } = await readTranscriptTitleInputs(cwd, id);
    expect(aiTitle).toBe('Fix login bug');
    expect(firstUserText).toBe('Fix login bug');
  });

  it('returns nulls when the local file is absent', async () => {
    const cwd = join(WS, 'dan.le', `title-missing-${seq + 100}`);
    expect(await readTranscriptTitleInputs(cwd, 'no-such')).toEqual({
      aiTitle: null,
      firstUserText: null,
    });
  });
});
