import { describe, expect, test } from 'bun:test';
import { unzipSync, type Zippable, zipSync } from 'fflate';
import {
  type DetectedSkill,
  detectSkills,
  normalizeArchive,
  type SkillFile,
  unzip,
} from '../../src/services/skills/extract';
import { SkillParseError } from '../../src/services/skills/frontmatter';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function skillMd(name: string, description?: string): Uint8Array {
  const desc = description !== undefined ? `description: ${description}\n` : '';
  return enc(`---\nname: ${name}\n${desc}---\n\n${description ?? 'Body.'}\n`);
}

function zip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries as Zippable);
}

function findFile(skill: DetectedSkill, path: string): SkillFile | undefined {
  return skill.files.find((f) => f.path === path);
}

describe('detectSkills root detection', () => {
  test('root SKILL.md at zip root returns 1 skill with name from frontmatter', () => {
    const files: SkillFile[] = [{ path: 'SKILL.md', bytes: skillMd('root-skill', 'Root level') }];
    const { skills, errors } = detectSkills(files);
    expect(errors).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('root-skill');
    expect(skills[0]?.description).toBe('Root level');
    expect(findFile(skills[0]!, 'SKILL.md')).toBeDefined();
  });

  test('name/SKILL.md (one subdir): support files stripped of root prefix', () => {
    const files: SkillFile[] = [
      { path: 'my-skill/SKILL.md', bytes: skillMd('my-skill', 'Has support') },
      { path: 'my-skill/reference.txt', bytes: enc('ref') },
      { path: 'my-skill/nested/data.json', bytes: enc('{}') },
    ];
    const { skills, errors } = detectSkills(files);
    expect(errors).toEqual([]);
    expect(skills).toHaveLength(1);
    const s = skills[0]!;
    expect(s.name).toBe('my-skill');
    expect(findFile(s, 'SKILL.md')).toBeDefined();
    expect(findFile(s, 'reference.txt')).toBeDefined();
    expect(findFile(s, 'nested/data.json')).toBeDefined();
    // The original prefixed paths must not survive.
    expect(findFile(s, 'my-skill/reference.txt')).toBeUndefined();
  });

  test('multi-skill sibling dirs returns 2 skills', () => {
    const files: SkillFile[] = [
      { path: 'a/SKILL.md', bytes: skillMd('alpha') },
      { path: 'b/SKILL.md', bytes: skillMd('beta') },
    ];
    const { skills, errors } = detectSkills(files);
    expect(errors).toEqual([]);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  test('nesting rejection: a/SKILL.md + a/b/SKILL.md reports error, excludes both', () => {
    const files: SkillFile[] = [
      { path: 'a/SKILL.md', bytes: skillMd('outer') },
      { path: 'a/b/SKILL.md', bytes: skillMd('inner') },
    ];
    const { skills, errors } = detectSkills(files);
    expect(skills).toHaveLength(0);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => /nested/i.test(e.message))).toBe(true);
  });

  test('no SKILL.md present reports an error and resolves nothing', () => {
    const files: SkillFile[] = [{ path: 'readme.txt', bytes: enc('hi') }];
    const { skills, errors } = detectSkills(files);
    expect(skills).toHaveLength(0);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detectSkills casing + collisions + caps', () => {
  test('lowercase skill.md accepted, emitted entry is uppercase SKILL.md', () => {
    const files: SkillFile[] = [{ path: 'lc/skill.md', bytes: skillMd('lower-case') }];
    const { skills, errors } = detectSkills(files);
    expect(errors).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(findFile(skills[0]!, 'SKILL.md')).toBeDefined();
    expect(findFile(skills[0]!, 'skill.md')).toBeUndefined();
  });

  test('SKILL.md entry carries original bytes', () => {
    const original = skillMd('byte-skill', 'desc');
    const files: SkillFile[] = [{ path: 'byte-skill/SKILL.md', bytes: original }];
    const { skills } = detectSkills(files);
    expect(findFile(skills[0]!, 'SKILL.md')?.bytes).toBe(original);
  });

  test('intra-set name collision resolves 0 skills + a collision error', () => {
    const files: SkillFile[] = [
      { path: 'a/SKILL.md', bytes: skillMd('same') },
      { path: 'b/SKILL.md', bytes: skillMd('same') },
    ];
    const { skills, errors } = detectSkills(files);
    expect(skills).toHaveLength(0);
    const collision = errors.filter((e) => /resolve to the name "same"/.test(e.message));
    expect(collision).toHaveLength(1);
    expect(collision[0]?.name).toBe('same');
  });

  test('support file >2 MiB yields an error (with name) and skill not resolved', () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const files: SkillFile[] = [
      { path: 'capped/SKILL.md', bytes: skillMd('capped') },
      { path: 'capped/huge.bin', bytes: big },
    ];
    const { skills, errors } = detectSkills(files);
    expect(skills).toHaveLength(0);
    const capErr = errors.find((e) => e.name === 'capped' && /2 MiB per-file/.test(e.message));
    expect(capErr).toBeDefined();
  });

  test('a frontmatter parse error in one root does not block a sibling', () => {
    const files: SkillFile[] = [
      { path: 'good/SKILL.md', bytes: skillMd('good-one') },
      { path: 'bad/SKILL.md', bytes: enc('no fence here\n') },
    ];
    const { skills, errors } = detectSkills(files);
    expect(skills.map((s) => s.name)).toEqual(['good-one']);
    expect(errors.some((e) => /bad\/SKILL\.md/.test(e.message))).toBe(true);
  });
});

describe('unzip', () => {
  test('drops directory entries and junk paths', () => {
    const archive = zip({
      'SKILL.md': skillMd('z'),
      'sub/': new Uint8Array(0),
      'sub/file.txt': enc('keep'),
      '.DS_Store': enc('junk'),
      '__MACOSX/._SKILL.md': enc('junk'),
    });
    const out = unzip(archive);
    const paths = out.map((f) => f.path).sort();
    expect(paths).toEqual(['SKILL.md', 'sub/file.txt']);
  });

  test('throws SkillParseError on a non-zip buffer', () => {
    const notZip = enc('this is definitely not a zip file at all');
    expect(() => unzip(notZip)).toThrow(SkillParseError);
  });
});

describe('normalizeArchive', () => {
  test('round-trip preserves binary (non-UTF8) bytes byte-identically', () => {
    const binary = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const detected: DetectedSkill = {
      name: 'bin-skill',
      description: 'binary',
      files: [
        { path: 'SKILL.md', bytes: skillMd('bin-skill') },
        { path: 'data.bin', bytes: binary },
      ],
    };
    const { archive, sizeBytes, fileCount } = normalizeArchive(detected);
    expect(fileCount).toBe(2);
    expect(sizeBytes).toBe(detected.files[0]!.bytes.byteLength + binary.byteLength);

    const back = unzipSync(archive);
    expect(Array.from(back['data.bin']!)).toEqual(Array.from(binary));
  });

  test('identical content produces a byte-stable archive (fixed mtime)', () => {
    const detected: DetectedSkill = {
      name: 'stable',
      description: 'd',
      files: [{ path: 'SKILL.md', bytes: skillMd('stable') }],
    };
    const a = normalizeArchive(detected).archive;
    const b = normalizeArchive(detected).archive;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
