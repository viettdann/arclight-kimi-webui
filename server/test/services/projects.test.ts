import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  adoptProjectForUser,
  listProjectsForUser,
  ProjectNotFoundError,
} from '../../src/services/projects';
import { makeFakeDb } from '../_helpers';

// `slug('alice@example.com')` per server/src/auth/index.ts = 'alice'.
const USER_EMAIL = 'alice@example.com';
const USER_SLUG = 'alice';
const USER_ID = 'u1';

let tmpRoot: string;
let userRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'kimi-projects-svc-'));
  userRoot = path.join(tmpRoot, USER_SLUG);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('listProjectsForUser', () => {
  it('FS empty + DB empty → []', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // selectDistinct
    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual([]);
  });

  it('mkdir -p userRoot when missing', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    const s = await stat(userRoot);
    expect(s.isDirectory()).toBe(true);
  });

  it('FS has 2 dirs, DB empty → 2 local projects, sorted ASC', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'proj-b'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'proj-a'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([]);

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => p.name)).toEqual(['proj-a', 'proj-b']);
    expect(result.every((p) => p.origin === 'local')).toBe(true);
    expect(result[0]?.workDir).toBe(path.join(userRoot, 'proj-a'));
  });

  it('skips plain files in userRoot', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'real-proj'), { mode: 0o700 });
    await writeFile(path.join(userRoot, 'stray.txt'), 'ignored');

    const fake = makeFakeDb();
    fake.selectQueue.push([]);

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => p.name)).toEqual(['real-proj']);
  });

  it('FS empty, DB has session with projectName=alpha → 1 foreign project', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ projectName: 'alpha' }]);

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual([
      { name: 'alpha', workDir: path.join(userRoot, 'alpha'), origin: 'foreign' },
    ]);
  });

  it('FS has alpha + DB has alpha → 1 local project (FS wins)', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'alpha'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([{ projectName: 'alpha' }]);

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual([
      { name: 'alpha', workDir: path.join(userRoot, 'alpha'), origin: 'local' },
    ]);
  });

  it('FS has alpha + DB has beta → 2 projects, alpha local, beta foreign', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'alpha'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([{ projectName: 'beta' }]);

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual([
      { name: 'alpha', workDir: path.join(userRoot, 'alpha'), origin: 'local' },
      { name: 'beta', workDir: path.join(userRoot, 'beta'), origin: 'foreign' },
    ]);
  });

  it('sorts mixed origins via collator (FS b, DB a → a foreign first, b local second)', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'b'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([{ projectName: 'a' }]);

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => `${p.name}:${p.origin}`)).toEqual(['a:foreign', 'b:local']);
  });
});

describe('adoptProjectForUser', () => {
  it('throws ProjectNotFoundError when DB has no rows for (userId, projectName)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // pre-update probe → empty
    await expect(
      adoptProjectForUser({
        userId: USER_ID,
        userSlug: USER_SLUG,
        projectName: 'ghost',
        db: fake.db,
        env: { WORKSPACE_ROOT: tmpRoot },
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);

    // No mkdir, no update.
    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates.length).toBe(0);
  });

  it('creates project folder 0o700 and fires exactly one cascade UPDATE', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);

    const result = await adoptProjectForUser({
      userId: USER_ID,
      userSlug: USER_SLUG,
      projectName: 'kimi-dev',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });

    const expectedWorkDir = path.join(userRoot, 'kimi-dev');
    expect(result).toEqual({
      projectName: 'kimi-dev',
      workDir: expectedWorkDir,
      sessionCount: 3,
    });

    const s = await stat(expectedWorkDir);
    expect(s.isDirectory()).toBe(true);
    expect(s.mode & 0o777).toBe(0o700);

    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates.length).toBe(1);
    expect((updates[0]?.values as { workDir: string }).workDir).toBe(expectedWorkDir);
  });

  it('idempotent: second call still succeeds (mkdir recursive, UPDATE no-op)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ id: 's1' }]);
    fake.selectQueue.push([{ id: 's1' }]);

    await adoptProjectForUser({
      userId: USER_ID,
      userSlug: USER_SLUG,
      projectName: 'kimi-dev',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    const result2 = await adoptProjectForUser({
      userId: USER_ID,
      userSlug: USER_SLUG,
      projectName: 'kimi-dev',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result2.sessionCount).toBe(1);
    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates.length).toBe(2);
  });
});
