import { describe, expect, it } from 'bun:test';
import type { GitCommandResponse } from 'shared/types/git-credentials';
import {
  buildArgs,
  classifyRemoteFailure,
  parseBranches,
  parseStatus,
} from '../../../src/services/git/commands';

// Build a NUL-separated porcelain v2 -z stdout from records. Real git emits a
// trailing NUL after the last record; the join + '\0' tail mirrors that.
function porcelainZ(records: string[]): string {
  return records.map((r) => `${r}\0`).join('');
}

describe('parseStatus', () => {
  it('parses branch name, ahead/behind, and entries correctly', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: porcelainZ([
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3',
        '1 .M N... 100644 100644 100644 hH hI path/to/file.ts',
        '1 M. N... 100644 100644 100644 hH hI another/file.ts',
        '? untracked.txt',
        '! ignored.txt',
      ]),
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);

    expect(result.branch).toBe('main');
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(3);
    expect(result.entries).toHaveLength(4);

    expect(result.entries[0]).toEqual({ statusCode: '.M', path: 'path/to/file.ts' });
    expect(result.entries[1]).toEqual({ statusCode: 'M.', path: 'another/file.ts' });
    expect(result.entries[2]).toEqual({ statusCode: '? ', path: 'untracked.txt' });
    expect(result.entries[3]).toEqual({ statusCode: '! ', path: 'ignored.txt' });
  });

  it('keeps spaces in paths intact (no quoting with -z)', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: porcelainZ([
        '# branch.head main',
        '1 .M N... 100644 100644 100644 hH hI my file.txt',
        '? a new file.txt',
      ]),
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);
    expect(result.entries[0]).toEqual({ statusCode: '.M', path: 'my file.txt' });
    expect(result.entries[1]).toEqual({ statusCode: '? ', path: 'a new file.txt' });
  });

  it('preserves unicode paths', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: porcelainZ(['# branch.head main', '? document.md']),
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);
    expect(result.entries[0]).toEqual({ statusCode: '? ', path: 'document.md' });
  });

  it('parses a rename entry with origPath as the following record', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: porcelainZ([
        '# branch.head main',
        '2 R. N... 100644 100644 100644 hH hI R100 new name.txt',
        'old name.txt',
        '1 .M N... 100644 100644 100644 hH hI plain.txt',
      ]),
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({
      statusCode: 'R.',
      path: 'new name.txt',
      origPath: 'old name.txt',
    });
    // The origPath record must NOT be re-parsed as its own entry.
    expect(result.entries[1]).toEqual({ statusCode: '.M', path: 'plain.txt' });
  });

  it('lists files inside untracked subdirectories', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: porcelainZ(['# branch.head main', '? udir/inner.txt', '? udir/nested/deep.txt']),
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);
    expect(result.entries.map((e) => e.path)).toEqual(['udir/inner.txt', 'udir/nested/deep.txt']);
  });

  it('marks branch as null when detached', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: porcelainZ(['# branch.head (detached)']),
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);
    expect(result.branch).toBeNull();
  });

  it('handles empty stdout', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    };

    const result = parseStatus(raw);
    expect(result.branch).toBeNull();
    expect(result.entries).toEqual([]);
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });
});

describe('buildArgs', () => {
  it('returns diff args without --stat', () => {
    expect(buildArgs('diff', ['--staged'])).toEqual(['diff', '--staged']);
    expect(buildArgs('diff', ['--', 'path/to/file'])).toEqual(['diff', '--', 'path/to/file']);
  });

  it('returns status args with porcelain=v2, branch, all-untracked and -z', () => {
    expect(buildArgs('status', [])).toEqual([
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      '-z',
    ]);
  });

  it('returns log args with oneline and limit', () => {
    expect(buildArgs('log', [])).toEqual(['log', '--oneline', '-n', '50']);
    expect(buildArgs('log', ['--all'])).toEqual(['log', '--oneline', '-n', '50', '--all']);
  });

  it('returns branch args with -a', () => {
    expect(buildArgs('branch', [])).toEqual(['branch', '-a']);
  });

  it('returns checkout args with userArgs', () => {
    expect(buildArgs('checkout', ['feature'])).toEqual(['checkout', 'feature']);
    expect(buildArgs('checkout', ['-b', 'new-branch'])).toEqual(['checkout', '-b', 'new-branch']);
  });

  it('returns add args with file paths', () => {
    expect(buildArgs('add', ['file.ts'])).toEqual(['add', 'file.ts']);
  });

  it('returns commit args with message', () => {
    expect(buildArgs('commit', ['initial commit'])).toEqual(['commit', '-m', 'initial commit']);
  });

  it('throws when commit message is missing', () => {
    expect(() => buildArgs('commit', [])).toThrow('commit message required');
  });

  it('returns push args', () => {
    expect(buildArgs('push', ['origin', 'main'])).toEqual(['push', 'origin', 'main']);
  });

  it('returns pull args', () => {
    expect(buildArgs('pull', [])).toEqual(['pull']);
  });

  it('returns fetch args', () => {
    expect(buildArgs('fetch', ['origin'])).toEqual(['fetch', 'origin']);
  });

  it('returns stash args', () => {
    expect(buildArgs('stash', [])).toEqual(['stash']);
    expect(buildArgs('stash', ['pop'])).toEqual(['stash', 'pop']);
  });
});

describe('classifyRemoteFailure', () => {
  // A bare "HTTP 403" matches BOTH the forbidden pattern (/HTTP 403/) and the
  // generic auth pattern (/HTTP 4\d{2}/), so it exercises the ordering rule:
  // when a credential is applied, forbidden must win; otherwise it falls to auth.
  it('classifies a 403 as forbidden when a credential was applied', () => {
    const stderr = 'fatal: unable to access ...: HTTP 403';
    expect(classifyRemoteFailure(128, stderr, true)).toBe('forbidden');
  });

  it('classifies a 403 as auth when no credential was applied', () => {
    const stderr = 'fatal: unable to access ...: HTTP 403';
    expect(classifyRemoteFailure(128, stderr, false)).toBe('auth');
  });

  it('classifies an authentication failure as auth even when a credential was applied', () => {
    const stderr = 'fatal: Authentication failed for ...';
    expect(classifyRemoteFailure(128, stderr, true)).toBe('auth');
  });

  it('classifies GitHub "Permission to x/y denied" as forbidden when applied', () => {
    const stderr = 'remote: Permission to x/y.git denied to user.';
    expect(classifyRemoteFailure(128, stderr, true)).toBe('forbidden');
  });

  it('classifies an Azure DevOps TF40xxxx error as forbidden when applied', () => {
    const stderr = 'remote: TF401027: You need the Git ... permission.';
    expect(classifyRemoteFailure(128, stderr, true)).toBe('forbidden');
  });

  it('returns null when exitCode is 0', () => {
    expect(classifyRemoteFailure(0, 'The requested URL returned error: 403', true)).toBeNull();
  });

  it('returns null when stderr matches no pattern', () => {
    expect(classifyRemoteFailure(1, 'fatal: not a git repository', true)).toBeNull();
    expect(classifyRemoteFailure(1, 'fatal: not a git repository', false)).toBeNull();
  });
});

describe('parseBranches', () => {
  it('detects current branch and remote branches', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: ['* main', '  feature', '+ remotes/origin/main', '  remotes/origin/feature', ''].join(
        '\n',
      ),
      stderr: '',
      timedOut: false,
    };

    const result = parseBranches(raw);

    expect(result.currentBranch).toBe('main');
    expect(result.branches).toHaveLength(4);

    expect(result.branches[0]).toEqual({ name: 'main', isCurrent: true, isRemote: false });
    expect(result.branches[1]).toEqual({ name: 'feature', isCurrent: false, isRemote: false });
    expect(result.branches[2]).toEqual({
      name: 'remotes/origin/main',
      isCurrent: false,
      isRemote: true,
    });
    expect(result.branches[3]).toEqual({
      name: 'remotes/origin/feature',
      isCurrent: false,
      isRemote: true,
    });
  });

  it('handles empty stdout', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    };

    const result = parseBranches(raw);
    expect(result.currentBranch).toBeNull();
    expect(result.branches).toEqual([]);
  });
});
