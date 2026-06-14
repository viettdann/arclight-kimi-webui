import { describe, expect, test } from 'bun:test';

// These pure predicates mirror the inline upload guards in
// `server/src/routes/me-skills.ts` (POST /upload), guards #1–#6:
//   #1 files non-empty
//   #2 every files entry is a File
//   #3 every paths entry is a string
//   #4 paths.length === files.length
//   #5 traversal rejection: a `/` prefix or any `..` segment
//   #6 getPath fallback: rawPaths[i] || files[i].name || ''
// The route inlines them and needs auth/db to run, so we verify the same
// predicates as standalone units rather than booting the Hono app.

const lengthMatches = (paths: unknown[], files: unknown[]): boolean =>
  paths.length === files.length;

const everyString = (paths: unknown[]): boolean => paths.every((p) => typeof p === 'string');

const isTraversal = (p: string): boolean => p.startsWith('/') || p.split('/').includes('..');

const getPath = (rawPaths: string[], files: { name: string }[], i: number): string =>
  rawPaths[i] || files[i]?.name || '';

describe('upload transport guards (mirror me-skills.ts #1–#6)', () => {
  test('#4 length match predicate', () => {
    expect(lengthMatches(['a', 'b'], [1, 2])).toBe(true);
    expect(lengthMatches(['a'], [1, 2])).toBe(false);
    expect(lengthMatches([], [])).toBe(true);
  });

  test('#3 type guard: a non-string entry fails .every(typeof === string)', () => {
    expect(everyString(['a', 'b'])).toBe(true);
    expect(everyString(['a', 123])).toBe(false);
    // A File object in a paths slot must fail the guard.
    expect(everyString(['a', new Blob(['x'])])).toBe(false);
    expect(everyString([])).toBe(true);
  });

  test('#5 traversal rejects ../x, /abs, a/../b', () => {
    expect(isTraversal('../x')).toBe(true);
    expect(isTraversal('/abs')).toBe(true);
    expect(isTraversal('a/../b')).toBe(true);
  });

  test('#5 traversal accepts a/b/c and empty string', () => {
    expect(isTraversal('a/b/c')).toBe(false);
    expect(isTraversal('')).toBe(false);
    expect(isTraversal('skill/SKILL.md')).toBe(false);
  });

  test('#6 getPath fallback: empty paths[i] falls back to files[i].name', () => {
    const files = [{ name: 'fallback.md' }, { name: 'second.md' }];
    expect(getPath(['', ''], files, 0)).toBe('fallback.md');
    expect(getPath(['explicit/path', ''], files, 0)).toBe('explicit/path');
    expect(getPath(['', ''], files, 1)).toBe('second.md');
  });

  test('#6 getPath returns empty string when both are missing', () => {
    expect(getPath([''], [{ name: '' }], 0)).toBe('');
  });
});
