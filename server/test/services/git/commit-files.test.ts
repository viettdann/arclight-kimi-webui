import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitFiles, UnknownFilesError } from '../../../src/services/git/commands';

// These tests drive a real git repo in a temp dir. The git binary is assumed
// present (same assumption the rest of the git service makes).

let repo: string;

async function git(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['git', ...args],
    cwd: repo,
    env: { ...(process.env as Record<string, string>), GIT_TERMINAL_PROMPT: '0' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function write(rel: string, content: string): Promise<void> {
  await Bun.write(path.join(repo, rel), content);
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'commit-files-'));
  await git(['init', '-q']);
  await git(['config', 'user.email', 'base@x.com']);
  await git(['config', 'user.name', 'base']);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const author = { userName: 'Commit Author', userEmail: 'author@x.com' };

describe('commitFiles', () => {
  it('commits only the selected file, leaving others uncommitted', async () => {
    await write('a.txt', '1\n');
    await write('b.txt', '2\n');
    await git(['add', 'a.txt', 'b.txt']);
    await git(['commit', '-qm', 'init']);
    await write('a.txt', '1\nmod-a\n');
    await write('b.txt', '2\nmod-b\n');

    const res = await commitFiles({ cwd: repo, files: ['a.txt'], message: 'only a', ...author });
    expect(res.exitCode).toBe(0);

    // b.txt remains modified and uncommitted.
    const st = await git(['status', '--porcelain']);
    expect(st.stdout).toContain('b.txt');
    expect(st.stdout).not.toContain('a.txt');
  });

  it('includes a selected untracked file via intent-add', async () => {
    await write('seed.txt', 's\n');
    await git(['add', 'seed.txt']);
    await git(['commit', '-qm', 'init']);
    await write('new.txt', 'new\n');

    const res = await commitFiles({ cwd: repo, files: ['new.txt'], message: 'add new', ...author });
    expect(res.exitCode).toBe(0);

    // new.txt is now tracked at HEAD and the tree is clean.
    const ls = await git(['ls-files', 'new.txt']);
    expect(ls.stdout.trim()).toBe('new.txt');
    const st = await git(['status', '--porcelain']);
    expect(st.stdout.trim()).toBe('');
  });

  it('commits both halves of a rename when the new path is selected', async () => {
    await write('old.txt', 'orig\n');
    await git(['add', 'old.txt']);
    await git(['commit', '-qm', 'init']);
    await git(['mv', 'old.txt', 'new.txt']);
    await write('new.txt', 'orig\nmod\n');

    // Caller selects only the new path (as GitStatusEntry.path reports it).
    const res = await commitFiles({
      cwd: repo,
      files: ['new.txt'],
      message: 'rename',
      ...author,
    });
    expect(res.exitCode).toBe(0);

    // No leftover staged delete of old.txt — tree clean of the rename.
    const st = await git(['status', '--porcelain']);
    expect(st.stdout.trim()).toBe('');
    const ls = await git(['ls-files']);
    expect(ls.stdout).toContain('new.txt');
    expect(ls.stdout).not.toContain('old.txt');
  });

  it('records the supplied identity as author and committer', async () => {
    await write('seed.txt', 's\n');
    await git(['add', 'seed.txt']);
    await git(['commit', '-qm', 'init']);
    await write('seed.txt', 's\nmod\n');

    const res = await commitFiles({ cwd: repo, files: ['seed.txt'], message: 'msg', ...author });
    expect(res.exitCode).toBe(0);

    const show = await git(['show', '-s', '--format=%an <%ae>|%cn <%ce>', 'HEAD']);
    expect(show.stdout.trim()).toBe('Commit Author <author@x.com>|Commit Author <author@x.com>');
  });

  it('handles a leading-dash filename without treating it as a flag', async () => {
    await write('seed.txt', 's\n');
    await git(['add', 'seed.txt']);
    await git(['commit', '-qm', 'init']);
    await write('-weird.txt', 'x\n');

    const res = await commitFiles({
      cwd: repo,
      files: ['-weird.txt'],
      message: 'dash file',
      ...author,
    });
    expect(res.exitCode).toBe(0);
    const ls = await git(['ls-files', '--', '-weird.txt']);
    expect(ls.stdout.trim()).toBe('-weird.txt');
  });

  it('throws UnknownFilesError for a file that is not in status', async () => {
    await write('seed.txt', 's\n');
    await git(['add', 'seed.txt']);
    await git(['commit', '-qm', 'init']);
    await write('seed.txt', 's\nmod\n');

    let thrown: unknown;
    try {
      await commitFiles({ cwd: repo, files: ['seed.txt', 'ghost.txt'], message: 'm', ...author });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnknownFilesError);
    expect((thrown as UnknownFilesError).files).toEqual(['ghost.txt']);
  });
});
