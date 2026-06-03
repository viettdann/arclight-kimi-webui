import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupInterruptedClones } from '../src/services/reconcile';

let root: string;

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'kimi-reconcile-clone-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cleanupInterruptedClones', () => {
  it('removes a marked folder but leaves unmarked projects untouched', async () => {
    const userRoot = path.join(root, 'alice');
    await mkdir(userRoot, { recursive: true });

    // Interrupted clone: marker + half-cloned folder.
    await mkdir(path.join(userRoot, 'half'), { recursive: true });
    await writeFile(path.join(userRoot, 'half', 'partial.pack'), 'x');
    await writeFile(path.join(userRoot, '.cloning-half'), '');

    // A finished clone and an empty blank project — neither is marked.
    await mkdir(path.join(userRoot, 'ready', '.git'), { recursive: true });
    await mkdir(path.join(userRoot, 'blank'), { recursive: true });

    await cleanupInterruptedClones(root);

    expect(await exists(path.join(userRoot, 'half'))).toBe(false);
    expect(await exists(path.join(userRoot, '.cloning-half'))).toBe(false);
    expect(await exists(path.join(userRoot, 'ready'))).toBe(true);
    expect(await exists(path.join(userRoot, 'blank'))).toBe(true);
  });

  it('is a no-op when the workspace root does not exist', async () => {
    await expect(cleanupInterruptedClones(path.join(root, 'nope'))).resolves.toBeUndefined();
  });
});
