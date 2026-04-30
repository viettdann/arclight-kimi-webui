import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveUserPath } from '../src/lib/path-guard';

describe('resolveUserPath', () => {
  let tmpRoot: string;
  let userRoot: string;
  let outsideDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'path-guard-'));
    userRoot = path.join(tmpRoot, 'user');
    outsideDir = path.join(tmpRoot, 'outside');
    await mkdir(userRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects NUL byte (\\0) in middle of relPath', async () => {
    await expect(resolveUserPath(userRoot, 'foo\0bar')).rejects.toThrow(/null byte/);
  });

  it('rejects leading "/" (absolute path)', async () => {
    await expect(resolveUserPath(userRoot, '/etc/passwd')).rejects.toThrow(/absolute/);
  });

  it('rejects ".." traversal that escapes userRoot', async () => {
    await expect(resolveUserPath(userRoot, '../outside/secret')).rejects.toThrow(/escapes/);
  });

  it('rejects symlink whose realpath escapes userRoot', async () => {
    const secret = path.join(outsideDir, 'secret.txt');
    await writeFile(secret, 'top secret');
    const linkPath = path.join(userRoot, 'leak');
    await symlink(secret, linkPath);
    await expect(resolveUserPath(userRoot, 'leak')).rejects.toThrow(/realpath/);
  });

  it('accepts a valid nested relPath under userRoot', async () => {
    const nestedDir = path.join(userRoot, 'a', 'b');
    await mkdir(nestedDir, { recursive: true });
    const target = path.join(nestedDir, 'file.txt');
    await writeFile(target, 'ok');
    const resolved = await resolveUserPath(userRoot, 'a/b/file.txt');
    expect(resolved).toBe(target);
  });

  it('accepts a relPath that does not yet exist (e.g. for upload)', async () => {
    const resolved = await resolveUserPath(userRoot, 'new/file.txt');
    expect(resolved).toBe(path.join(userRoot, 'new/file.txt'));
  });
});
