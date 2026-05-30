import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { env } from '../../src/env';
import {
  encodeCwd,
  MAX_ENCODED_LEN,
  subagentDir,
  transcriptPath,
} from '../../src/services/agent/transcript-store';

// Derive the expected prefix from the (test-stubbed) env rather than hardcoding
// an absolute path: setup.ts leaves CLAUDE_CONFIG_DIR unset, so it resolves to
// `${DATA_DIR}/claude-config`. We assert the composed structure, not the host.
const PROJECTS = join(env.CLAUDE_CONFIG_DIR, 'projects');

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
  it('composes PROJECTS/<enc>/<id>.jsonl', () => {
    const cwd = '/data/workspace/user-slug/my-project';
    const id = '11111111-2222-3333-4444-555555555555';
    expect(transcriptPath(cwd, id)).toBe(
      join(PROJECTS, '-data-workspace-user-slug-my-project', `${id}.jsonl`),
    );
  });

  it('uses the encoded cwd as the project dir', () => {
    const path = transcriptPath('/a/b', 'sess-1');
    expect(path).toBe(join(PROJECTS, '-a-b', 'sess-1.jsonl'));
  });
});

describe('subagentDir', () => {
  it('composes PROJECTS/<enc>/<id>/subagents', () => {
    const cwd = '/data/workspace/user-slug/my-project';
    const id = '11111111-2222-3333-4444-555555555555';
    expect(subagentDir(cwd, id)).toBe(
      join(PROJECTS, '-data-workspace-user-slug-my-project', id, 'subagents'),
    );
  });

  it('nests under the same encoded project dir as the transcript', () => {
    const cwd = '/a/b';
    const id = 'sess-1';
    expect(subagentDir(cwd, id)).toBe(join(PROJECTS, '-a-b', id, 'subagents'));
  });
});
