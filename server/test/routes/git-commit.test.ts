import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import type { GitCommandResponse } from 'shared/types/git-credentials';
import { slug } from '../../src/auth';
import type { AuthVariables } from '../../src/auth/middleware';
import { createGitRouter } from '../../src/routes/git';
import { makeFakeDb } from '../_helpers';

const USER = { id: 'u1', name: 'Commit Author', email: 'author@x.com' };
const PROJECT = 'proj';

let workspaceRoot: string;
let repo: string;

function buildApp(): Hono<{ Variables: AuthVariables }> {
  const fake = makeFakeDb();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', USER as never);
    c.set('authSession', null as never);
    await next();
  });
  app.route('/api/git', createGitRouter({ db: fake.db, env: { WORKSPACE_ROOT: workspaceRoot } }));
  return app;
}

async function git(args: string[]): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn({
    cmd: ['git', ...args],
    cwd: repo,
    env: { ...(process.env as Record<string, string>), GIT_TERMINAL_PROMPT: '0' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return { exitCode, stdout };
}

async function write(rel: string, content: string): Promise<void> {
  await Bun.write(path.join(repo, rel), content);
}

async function commit(body: unknown): Promise<Response> {
  const app = buildApp();
  return app.request('/api/git/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), 'git-commit-route-'));
  repo = path.join(workspaceRoot, slug(USER.email), PROJECT);
  await mkdir(repo, { recursive: true });
  await git(['init', '-q']);
  await git(['config', 'user.email', 'base@x.com']);
  await git(['config', 'user.name', 'base']);
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('POST /api/git/commit', () => {
  it('commits selected files, leaving unselected ones uncommitted', async () => {
    await write('a.txt', '1\n');
    await write('b.txt', '2\n');
    await git(['add', 'a.txt', 'b.txt']);
    await git(['commit', '-qm', 'init']);
    await write('a.txt', '1\nmod\n');
    await write('b.txt', '2\nmod\n');

    const res = await commit({ projectName: PROJECT, files: ['a.txt'], message: 'only a' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GitCommandResponse;
    expect(body.exitCode).toBe(0);

    const st = await git(['status', '--porcelain']);
    expect(st.stdout).toContain('b.txt');
    expect(st.stdout).not.toContain('a.txt');
  });

  it('uses the authed user identity as author/committer', async () => {
    await write('seed.txt', 's\n');
    await git(['add', 'seed.txt']);
    await git(['commit', '-qm', 'init']);
    await write('seed.txt', 's\nmod\n');

    const res = await commit({ projectName: PROJECT, files: ['seed.txt'], message: 'm' });
    expect(res.status).toBe(200);

    const show = await git(['show', '-s', '--format=%an <%ae>', 'HEAD']);
    expect(show.stdout.trim()).toBe('Commit Author <author@x.com>');
  });

  it('rejects a path traversal with 403', async () => {
    const res = await commit({ projectName: PROJECT, files: ['../escape.txt'], message: 'm' });
    expect(res.status).toBe(403);
  });

  it('returns 400 unknown_files for a file not in status', async () => {
    await write('seed.txt', 's\n');
    await git(['add', 'seed.txt']);
    await git(['commit', '-qm', 'init']);

    const res = await commit({ projectName: PROJECT, files: ['ghost.txt'], message: 'm' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'unknown_files' });
  });

  it('returns 400 when files is empty', async () => {
    const res = await commit({ projectName: PROJECT, files: [], message: 'm' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is blank', async () => {
    const res = await commit({ projectName: PROJECT, files: ['a.txt'], message: '   ' });
    expect(res.status).toBe(400);
  });
});
