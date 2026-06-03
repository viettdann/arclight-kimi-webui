import { describe, expect, it } from 'bun:test';
import { buildArgs, parseBranches, parseStatus } from '../../../src/services/git/commands';
import type { GitCommandResponse } from 'shared/types/git-credentials';

describe('parseStatus', () => {
  it('parses branch name, ahead/behind, and entries correctly', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: [
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3',
        '1 .M sub ... path/to/file.ts',
        '1 M. sub ... another/file.ts',
        '? untracked.txt',
        '! ignored.txt',
        '',
      ].join('\n'),
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

  it('marks branch as null when detached', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: '# branch.head (detached)\n',
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

  it('returns status args with porcelain=v2 and branch', () => {
    expect(buildArgs('status', [])).toEqual(['status', '--porcelain=v2', '--branch']);
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

describe('parseBranches', () => {
  it('detects current branch and remote branches', () => {
    const raw: GitCommandResponse = {
      exitCode: 0,
      stdout: [
        '* main',
        '  feature',
        '+ remotes/origin/main',
        '  remotes/origin/feature',
        '',
      ].join('\n'),
      stderr: '',
      timedOut: false,
    };

    const result = parseBranches(raw);

    expect(result.currentBranch).toBe('main');
    expect(result.branches).toHaveLength(4);

    expect(result.branches[0]).toEqual({ name: 'main', isCurrent: true, isRemote: false });
    expect(result.branches[1]).toEqual({ name: 'feature', isCurrent: false, isRemote: false });
    expect(result.branches[2]).toEqual({ name: 'remotes/origin/main', isCurrent: false, isRemote: true });
    expect(result.branches[3]).toEqual({ name: 'remotes/origin/feature', isCurrent: false, isRemote: true });
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
