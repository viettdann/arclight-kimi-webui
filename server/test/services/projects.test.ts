import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AuditEvent } from '../../src/lib/logger';
import {
  adoptProjectForUser,
  deleteProjectForUser,
  listProjectsForUser,
  ProjectNotFoundError,
  statProjectForUser,
} from '../../src/services/projects';
import { SessionManager } from '../../src/services/session-manager';
import { SITE_SETTING_KEYS } from '../../src/services/site-settings';
import { makeFakeDb } from '../_helpers';

const ENTRIES_KEY = SITE_SETTING_KEYS.projectDiscoveryEntries;
const OVERRIDE_KEY = SITE_SETTING_KEYS.projectDiscoveryOverride;

async function gitInit(dir: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: ['git', 'init', '-q'],
    cwd: dir,
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
  });
  await proc.exited;
}

// `slug('alice@example.com')` per server/src/auth/index.ts = 'alice'.
const USER_EMAIL = 'alice@example.com';
const USER_SLUG = 'alice';
const USER_ID = 'u1';

let tmpRoot: string;
let userRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'mtc-projects-svc-'));
  userRoot = path.join(tmpRoot, USER_SLUG);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('listProjectsForUser', () => {
  it('FS empty + DB empty → []', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([]); // selectDistinct projectNames
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
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([]); // selectDistinct projectNames
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
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([]); // selectDistinct projectNames

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
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([]); // selectDistinct projectNames

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
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([{ projectName: 'alpha' }]); // selectDistinct projectNames

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
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([{ projectName: 'alpha' }]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual([
      { name: 'alpha', workDir: path.join(userRoot, 'alpha'), origin: 'local', status: 'ready' },
    ]);
  });

  it('FS has alpha + DB has beta → 2 projects, alpha local, beta foreign', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'alpha'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([{ projectName: 'beta' }]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual([
      { name: 'alpha', workDir: path.join(userRoot, 'alpha'), origin: 'local', status: 'ready' },
      { name: 'beta', workDir: path.join(userRoot, 'beta'), origin: 'foreign' },
    ]);
  });

  it('sorts mixed origins via collator (FS b, DB a → a foreign first, b local second)', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'b'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([]); // select site_settings
    fake.selectQueue.push([{ projectName: 'a' }]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => `${p.name}:${p.origin}`)).toEqual(['a:foreign', 'b:local']);
  });

  it('filters out default-blacklisted directories (e.g. .git, node_modules)', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'real-proj'), { mode: 0o700 });
    await mkdir(path.join(userRoot, '.git'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'node_modules'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([]); // select site_settings (no rows = defaults)
    fake.selectQueue.push([]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => p.name)).toEqual(['real-proj']);
  });

  it('append mode: custom entries merge with defaults', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'real-proj'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'custom-ignore'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([
      { key: ENTRIES_KEY, value: ['custom-ignore'] },
      { key: OVERRIDE_KEY, value: false },
    ]); // select site_settings (append)
    fake.selectQueue.push([]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => p.name)).toEqual(['real-proj']);
  });

  it('override mode: only custom entries are used (non-default names still scan)', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    // `node_modules` is a default-only entry; under override it's dropped from
    // the blacklist, so it scans as a project again.
    await mkdir(path.join(userRoot, 'node_modules'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'other-ignore'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'real-proj'), { mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([
      { key: ENTRIES_KEY, value: ['other-ignore'] },
      { key: OVERRIDE_KEY, value: true },
    ]); // select site_settings (override)
    fake.selectQueue.push([]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    // node_modules scans (not in custom entries); other-ignore is filtered.
    expect(result.map((p) => p.name)).toEqual(['node_modules', 'real-proj']);
  });

  it('dot-folders are always skipped, even in override mode', async () => {
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, '.git'), { mode: 0o700 });
    await mkdir(path.join(userRoot, '.some-future-tool'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'real-proj'), { mode: 0o700 });

    const fake = makeFakeDb();
    // Override with an empty blacklist — the dot rule is independent of it.
    fake.selectQueue.push([
      { key: ENTRIES_KEY, value: [] },
      { key: OVERRIDE_KEY, value: true },
    ]); // select site_settings (override, empty)
    fake.selectQueue.push([]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => p.name)).toEqual(['real-proj']);
  });

  it('filters blacklisted foreign project names too', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // select site_settings (no rows = defaults)
    fake.selectQueue.push([{ projectName: 'node_modules' }, { projectName: 'real-proj' }]); // selectDistinct projectNames

    const result = await listProjectsForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.map((p) => p.name)).toEqual(['real-proj']);
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
      projectName: 'mtc-dev',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });

    const expectedWorkDir = path.join(userRoot, 'mtc-dev');
    expect(result).toEqual({
      projectName: 'mtc-dev',
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
      projectName: 'mtc-dev',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    const result2 = await adoptProjectForUser({
      userId: USER_ID,
      userSlug: USER_SLUG,
      projectName: 'mtc-dev',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result2.sessionCount).toBe(1);
    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates.length).toBe(2);
  });
});

describe('statProjectForUser', () => {
  it('reports a non-git folder: exists + entryCount + git=null', async () => {
    await mkdir(path.join(userRoot, 'proj'), { recursive: true, mode: 0o700 });
    await writeFile(path.join(userRoot, 'proj', 'README.md'), 'hi');

    const result = await statProjectForUser({
      userEmail: USER_EMAIL,
      projectName: 'proj',
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual({ exists: true, entryCount: 1, git: null });
  });

  it('reports exists=false for a missing folder', async () => {
    const result = await statProjectForUser({
      userEmail: USER_EMAIL,
      projectName: 'ghost',
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result).toEqual({ exists: false, entryCount: 0, git: null });
  });

  it('reports exists=false for a traversal name (path-guard)', async () => {
    const result = await statProjectForUser({
      userEmail: USER_EMAIL,
      projectName: '../../etc',
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.exists).toBe(false);
  });

  it('surfaces git info (dirty count) for a repo with an untracked file', async () => {
    const dir = path.join(userRoot, 'repo');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await gitInit(dir);
    await writeFile(path.join(dir, 'foo.txt'), 'x');

    const result = await statProjectForUser({
      userEmail: USER_EMAIL,
      projectName: 'repo',
      env: { WORKSPACE_ROOT: tmpRoot },
    });
    expect(result.exists).toBe(true);
    expect(result.git).not.toBeNull();
    expect(result.git?.dirtyCount).toBeGreaterThanOrEqual(1);
  });
});

describe('deleteProjectForUser', () => {
  let audit: AuditEvent[];
  let manager: SessionManager;

  beforeEach(() => {
    audit = [];
    manager = new SessionManager();
  });

  it('local project: removes folder + DB rows, emits audit', async () => {
    const localWorkDir = path.join(userRoot, 'proj');
    await mkdir(localWorkDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(localWorkDir, 'file.txt'), 'data');

    const fake = makeFakeDb();
    fake.selectQueue.push([{ id: 's1', workDir: localWorkDir }]);

    const result = await deleteProjectForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      projectName: 'proj',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
      manager,
      auditLog: (e) => audit.push(e),
    });

    expect(result).toEqual({ sessionCount: 1 });
    await expect(stat(localWorkDir)).rejects.toBeDefined();

    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(1);

    expect(audit).toContainEqual({
      userId: USER_ID,
      action: 'project_delete',
      path: 'proj',
      bytes: 0,
    });
  });

  it('foreign project (no local folder, has rows): deletes DB rows only', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ id: 's1', workDir: '/remote/machine/proj' }]);

    const result = await deleteProjectForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      projectName: 'proj',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
      manager,
      auditLog: (e) => audit.push(e),
    });

    expect(result).toEqual({ sessionCount: 1 });
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(1);
  });

  it("returns 'not_found' when neither DB rows nor folder exist", async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);

    const result = await deleteProjectForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      projectName: 'ghost',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
      manager,
      auditLog: (e) => audit.push(e),
    });

    expect(result).toBe('not_found');
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('self-heals a leftover folder with 0 DB rows (no DELETE, folder removed)', async () => {
    const localWorkDir = path.join(userRoot, 'orphan');
    await mkdir(localWorkDir, { recursive: true, mode: 0o700 });

    const fake = makeFakeDb();
    fake.selectQueue.push([]); // no rows — prior delete cut the DB already

    const result = await deleteProjectForUser({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      projectName: 'orphan',
      db: fake.db,
      env: { WORKSPACE_ROOT: tmpRoot },
      manager,
      auditLog: (e) => audit.push(e),
    });

    expect(result).toEqual({ sessionCount: 0 });
    await expect(stat(localWorkDir)).rejects.toBeDefined();
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
  });
});
