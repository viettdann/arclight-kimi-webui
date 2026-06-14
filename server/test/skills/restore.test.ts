import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Zippable, zipSync } from 'fflate';
import {
  type MaterializableSkill,
  reconcileSkillsDir,
  unpackArchive,
} from '../../src/services/skills/restore';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function skillArchive(name: string, extra: Record<string, string> = {}): Uint8Array {
  const z: Zippable = { 'SKILL.md': enc(`---\nname: ${name}\n---\nBody.\n`) };
  for (const [path, content] of Object.entries(extra)) z[path] = enc(content);
  return zipSync(z);
}

/** Build a MaterializableSkill backed by fixed bytes and an explicit signature.
 *  `load` counts how many times the archive was actually loaded. */
function mat(
  name: string,
  archive: Uint8Array,
  signature = 'sig-1',
): MaterializableSkill & { loads: () => number } {
  let loads = 0;
  return {
    name,
    signature,
    loadArchive: async () => {
      loads++;
      return archive;
    },
    loads: () => loads,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

let tmpRoot: string;
let skillsDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'skills-restore-'));
  skillsDir = join(tmpRoot, 'skills');
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('reconcileSkillsDir', () => {
  test('materializes a skill into skillsDir/<name>/ with nested support file', async () => {
    const archive = skillArchive('layout-skill', { 'docs/guide.txt': 'hello guide' });
    await reconcileSkillsDir(skillsDir, [mat('layout-skill', archive)]);

    const skillMdPath = join(skillsDir, 'layout-skill', 'SKILL.md');
    expect(await exists(skillMdPath)).toBe(true);
    expect(await readFile(skillMdPath, 'utf8')).toContain('name: layout-skill');

    const supportPath = join(skillsDir, 'layout-skill', 'docs', 'guide.txt');
    expect(await readFile(supportPath, 'utf8')).toBe('hello guide');
  });

  test('writes a manifest of signatures and skips re-load on an unchanged signature', async () => {
    const archive = skillArchive('manifest-skill');
    const first = mat('manifest-skill', archive, 'sig-A');
    await reconcileSkillsDir(skillsDir, [first]);

    const manifestPath = join(skillsDir, '.skills-manifest.json');
    expect(await exists(manifestPath)).toBe(true);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
    expect(manifest['manifest-skill']).toBe('sig-A');
    expect(first.loads()).toBe(1);

    // Second reconcile, same signature + dir present → archive is NOT re-loaded.
    const second = mat('manifest-skill', archive, 'sig-A');
    await reconcileSkillsDir(skillsDir, [second]);
    expect(second.loads()).toBe(0);
    expect(await readFile(join(skillsDir, 'manifest-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: manifest-skill',
    );
  });

  test('re-materializes when the signature changes', async () => {
    await reconcileSkillsDir(skillsDir, [mat('s', skillArchive('s', { 'v.txt': 'one' }), 'sig-1')]);
    expect(await readFile(join(skillsDir, 's', 'v.txt'), 'utf8')).toBe('one');

    const updated = mat('s', skillArchive('s', { 'v.txt': 'two' }), 'sig-2');
    await reconcileSkillsDir(skillsDir, [updated]);
    expect(updated.loads()).toBe(1);
    expect(await readFile(join(skillsDir, 's', 'v.txt'), 'utf8')).toBe('two');
  });

  test('prunes a pre-existing orphan dir not in enabled set', async () => {
    const orphanDir = join(skillsDir, 'orphan');
    await mkdir(orphanDir, { recursive: true });
    await Bun.write(join(orphanDir, 'stale.txt'), 'old');

    await reconcileSkillsDir(skillsDir, [mat('keeper', skillArchive('keeper'))]);

    expect(await exists(orphanDir)).toBe(false);
    expect(await exists(join(skillsDir, 'keeper'))).toBe(true);
  });

  test('disabled skill is removed and dropped from manifest on next reconcile', async () => {
    await reconcileSkillsDir(skillsDir, [mat('toggle-skill', skillArchive('toggle-skill'))]);
    expect(await exists(join(skillsDir, 'toggle-skill'))).toBe(true);

    // Now disabled: reconcile with empty set.
    await reconcileSkillsDir(skillsDir, []);
    expect(await exists(join(skillsDir, 'toggle-skill'))).toBe(false);

    const manifestPath = join(skillsDir, '.skills-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
    expect(manifest['toggle-skill']).toBeUndefined();
  });

  test('a failing archive does not block a valid sibling skill', async () => {
    await reconcileSkillsDir(skillsDir, [
      mat('broken', enc('not a zip at all')),
      mat('healthy', skillArchive('healthy')),
    ]);
    expect(await exists(join(skillsDir, 'healthy', 'SKILL.md'))).toBe(true);
    expect(await exists(join(skillsDir, 'broken'))).toBe(false);
  });
});

describe('unpackArchive zip-slip guard', () => {
  test('rejects an archive entry that traverses out via ..', async () => {
    const archive = zipSync({ '../evil.txt': enc('pwned') } as Zippable);
    const dest = join(tmpRoot, 'dest');
    await expect(unpackArchive(archive, dest)).rejects.toThrow();
    // The escape target must not have been written.
    expect(await exists(join(tmpRoot, 'evil.txt'))).toBe(false);
  });

  test('unpacks a well-formed archive', async () => {
    const archive = skillArchive('ok-skill', { 'a/b.txt': 'nested' });
    const dest = join(tmpRoot, 'dest2');
    await unpackArchive(archive, dest);
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('ok-skill');
    expect(await readFile(join(dest, 'a', 'b.txt'), 'utf8')).toBe('nested');
  });
});
