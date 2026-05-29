import { describe, expect, it } from 'bun:test';
import { CloneUrlError, deriveRepoName, parseCloneUrl } from '../../../src/services/git/url';

// Assert that `parseCloneUrl(input)` throws a CloneUrlError with `code`.
function expectThrowsWithCode(input: string, code: string): void {
  try {
    parseCloneUrl(input);
    throw new Error('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(CloneUrlError);
    expect((e as { code?: string }).code).toBe(code);
  }
}

describe('parseCloneUrl', () => {
  it('parses a full https github url', () => {
    const url = parseCloneUrl('https://github.com/org/repo.git');
    expect(url.host).toBe('github.com');
    expect(url.protocol).toBe('https:');
  });

  it('auto-prefixes https for a bare github host/path', () => {
    const url = parseCloneUrl('github.com/org/repo');
    expect(url.host).toBe('github.com');
    expect(url.protocol).toBe('https:');
  });

  it('auto-prefixes https for a bare azure devops host/path', () => {
    const url = parseCloneUrl('dev.azure.com/org/proj/_git/repo');
    expect(url.host).toBe('dev.azure.com');
    expect(url.protocol).toBe('https:');
  });

  it('rejects ssh:// scheme as unsupported_scheme', () => {
    expectThrowsWithCode('ssh://git@host/o/r.git', 'unsupported_scheme');
  });

  it('rejects git:// scheme as unsupported_scheme', () => {
    expectThrowsWithCode('git://host/r', 'unsupported_scheme');
  });

  it('rejects scp-style git@host:path as invalid_url', () => {
    expectThrowsWithCode('git@host:org/repo.git', 'invalid_url');
  });

  it('rejects an empty string as invalid_url', () => {
    expectThrowsWithCode('', 'invalid_url');
  });
});

describe('deriveRepoName', () => {
  it('strips .git from the last segment', () => {
    expect(deriveRepoName('https://github.com/org/repo.git')).toBe('repo');
  });

  it('returns the last segment when there is no .git', () => {
    expect(deriveRepoName('https://github.com/org/repo')).toBe('repo');
  });

  it('returns the repo segment after _git for azure devops', () => {
    expect(deriveRepoName('https://dev.azure.com/org/proj/_git/myrepo')).toBe('myrepo');
  });

  it('returns null for an invalid/empty url', () => {
    expect(deriveRepoName('')).toBeNull();
    expect(deriveRepoName('git@host:org/repo.git')).toBeNull();
  });
});
