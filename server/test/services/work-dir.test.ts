import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { deriveProjectName, ensureWorkDir, resolveWorkDir } from '../../src/services/work-dir';

describe('resolveWorkDir', () => {
  it('joins WORKSPACE_ROOT, slug(email), and projectName', () => {
    const got = resolveWorkDir({
      userEmail: 'alice@example.com',
      projectName: 'projA',
      env: { WORKSPACE_ROOT: '/ws' },
    });
    expect(got).toBe('/ws/alice/projA');
  });

  it('slug-sanitises the email local part', () => {
    const got = resolveWorkDir({
      userEmail: 'Alice.Smith+tag@Example.COM',
      projectName: 'proj',
      env: { WORKSPACE_ROOT: '/ws' },
    });
    expect(got).toBe('/ws/alice.smith_tag/proj');
  });

  it('preserves nested segments in projectName when caller passes them (boundary)', () => {
    const got = resolveWorkDir({
      userEmail: 'a@b.com',
      projectName: 'a/b',
      env: { WORKSPACE_ROOT: '/ws' },
    });
    expect(got).toBe('/ws/a/a/b');
  });
});

describe('deriveProjectName', () => {
  const userRoot = '/ws/alice';

  it('returns the first segment under userRoot', () => {
    expect(deriveProjectName(userRoot, '/ws/alice/projA')).toBe('projA');
    expect(deriveProjectName(userRoot, '/ws/alice/projA/sub/dir')).toBe('projA');
  });

  it('returns null when workDir equals userRoot', () => {
    expect(deriveProjectName(userRoot, userRoot)).toBeNull();
  });

  it('returns null when workDir escapes userRoot', () => {
    expect(deriveProjectName(userRoot, '/etc')).toBeNull();
    expect(deriveProjectName(userRoot, '/ws/bob/proj')).toBeNull();
    expect(deriveProjectName(userRoot, '/ws')).toBeNull();
  });
});

describe('ensureWorkDir', () => {
  const tmpRoot = path.join('/tmp', `kimi-workdir-test-${process.pid}`);

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates the directory recursively when missing', async () => {
    const target = path.join(tmpRoot, 'alice', 'projA');
    await ensureWorkDir(target);
    const s = await stat(target);
    expect(s.isDirectory()).toBe(true);
  });

  it('is idempotent — second call on an existing dir does not throw', async () => {
    const target = path.join(tmpRoot, 'alice', 'projB');
    await mkdir(target, { recursive: true });
    await ensureWorkDir(target);
    const s = await stat(target);
    expect(s.isDirectory()).toBe(true);
  });
});
