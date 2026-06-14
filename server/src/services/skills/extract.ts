import { unzipSync, type Zippable, zipSync } from 'fflate';
import { parseSkillMd, SkillParseError } from './frontmatter';
import { isJunkPath } from './junk';

/** A single file: a relative path and its raw bytes. */
export interface SkillFile {
  path: string;
  bytes: Uint8Array;
}

/** A skill detected from one input scope, ready to be normalized + stored. */
export interface DetectedSkill {
  name: string;
  description: string;
  /** Cleaned entries with paths relative to the skill root; the SKILL.md entry
   *  is always named uppercase `SKILL.md` and carries its original bytes. */
  files: SkillFile[];
}

export interface DetectError {
  name?: string;
  message: string;
}

export interface DetectResult {
  skills: DetectedSkill[];
  errors: DetectError[];
}

// Validation limits.
const PER_FILE_MAX = 2 * 1024 * 1024; // 2 MiB
const PER_SKILL_MAX = 10 * 1024 * 1024; // 10 MiB total (uncompressed)
const PER_SKILL_FILES = 200;
// Decompression-bomb ceiling for a single uploaded archive (which may hold
// several skills). The real per-skill limits are enforced later in
// `detectSkills`; this only bounds how much we ever inflate into memory.
const ARCHIVE_UNCOMPRESSED_MAX = 50 * 1024 * 1024; // 50 MiB

const SKILL_MD = 'SKILL.md';
// Fixed mtime (>= the zip 1980 epoch) so identical content yields an identical
// archive — keeps re-uploads byte-stable.
const FIXED_MTIME = new Date('2020-01-01T00:00:00Z');

function basename(path: string): string {
  return path.split('/').pop() ?? '';
}

function isSkillMd(path: string): boolean {
  return basename(path).toLowerCase() === 'skill.md';
}

/** Directory of a path, or the `'.'` root sentinel for a top-level file. */
function dirOf(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

function depth(dir: string): number {
  return dir === '.' ? 0 : dir.split('/').length;
}

/** True if `ancestor` strictly contains `dir`. The `'.'` root contains every
 *  non-root dir. */
function isAncestor(ancestor: string, dir: string): boolean {
  if (ancestor === dir) return false;
  if (ancestor === '.') return true;
  return dir.startsWith(`${ancestor}/`);
}

/**
 * Unzip a buffer into cleaned `SkillFile`s. Directory entries and junk are
 * dropped via the filter so they are never decompressed. The filter also bounds
 * decompression up front (per-entry and cumulative uncompressed size) so a
 * zip-bomb cannot be inflated into memory before the later caps run. Throws
 * SkillParseError when the buffer is not a valid zip or exceeds those bounds.
 */
export function unzip(buffer: Uint8Array): SkillFile[] {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false; // directory entry
        if (isJunkPath(f.name)) return false; // junk — don't decompress it
        // `originalSize` is the uncompressed size from the central directory,
        // available before this entry is inflated.
        if (f.originalSize > PER_FILE_MAX) {
          throw new SkillParseError(`${f.name} exceeds the 2 MiB per-file limit`);
        }
        total += f.originalSize;
        if (total > ARCHIVE_UNCOMPRESSED_MAX) {
          throw new SkillParseError('archive expands beyond the allowed size');
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SkillParseError) throw err;
    throw new SkillParseError(
      `not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return Object.entries(entries).map(([path, bytes]) => ({ path, bytes }));
}

/**
 * Detect skills from one input scope (a zip's entries, a folder bucket, or a
 * single synthesized SKILL.md). Performs root detection, nesting rejection,
 * deepest-first support-file assignment, frontmatter name/description parsing,
 * size/count caps, and intra-scope name-collision detection. Never throws;
 * recoverable problems become `errors` while independent skills still resolve.
 */
export function detectSkills(files: SkillFile[]): DetectResult {
  const errors: DetectError[] = [];

  // 1. Roots: every dir containing a SKILL.md/skill.md (last one wins per dir).
  const roots = new Map<string, SkillFile>();
  for (const f of files) {
    if (isSkillMd(f.path)) roots.set(dirOf(f.path), f);
  }
  if (roots.size === 0) {
    return { skills: [], errors: [{ message: 'no SKILL.md found in upload' }] };
  }

  // 2. Nesting rejection: any root contained by another taints both.
  const rootDirs = [...roots.keys()];
  const nested = new Set<string>();
  for (const a of rootDirs) {
    for (const b of rootDirs) {
      if (isAncestor(a, b)) {
        nested.add(a);
        nested.add(b);
      }
    }
  }
  if (nested.size > 0) {
    errors.push({
      message: `nested skills are not allowed: ${[...nested].sort().join(', ')}`,
    });
  }

  // 3. Assign non-SKILL.md files to the deepest valid root that contains them.
  const validRoots = rootDirs.filter((r) => !nested.has(r)).sort((a, b) => depth(b) - depth(a));
  const supportByRoot = new Map<string, SkillFile[]>();
  for (const r of validRoots) supportByRoot.set(r, []);
  for (const f of files) {
    if (isSkillMd(f.path)) continue;
    const root = validRoots.find((r) => (r === '.' ? true : f.path.startsWith(`${r}/`)));
    if (root !== undefined) supportByRoot.get(root)?.push(f);
  }

  // 4. Build a DetectedSkill per valid root; collect cap/parse errors.
  const built: DetectedSkill[] = [];
  const nameToCount = new Map<string, number>();
  for (const root of validRoots) {
    const skillMd = roots.get(root);
    if (!skillMd) continue;

    let meta: { name: string; description: string };
    try {
      meta = parseSkillMd(skillMd.bytes);
    } catch (err) {
      errors.push({
        message: `${root === '.' ? SKILL_MD : `${root}/SKILL.md`}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    if (skillMd.bytes.byteLength > PER_FILE_MAX) {
      errors.push({ name: meta.name, message: 'SKILL.md exceeds the 2 MiB per-file limit' });
      continue;
    }

    const outFiles: SkillFile[] = [{ path: SKILL_MD, bytes: skillMd.bytes }];
    let total = skillMd.bytes.byteLength;
    let capError = false;
    for (const sf of supportByRoot.get(root) ?? []) {
      const rel = root === '.' ? sf.path : sf.path.slice(root.length + 1);
      if (sf.bytes.byteLength > PER_FILE_MAX) {
        errors.push({ name: meta.name, message: `${rel} exceeds the 2 MiB per-file limit` });
        capError = true;
        break;
      }
      outFiles.push({ path: rel, bytes: sf.bytes });
      total += sf.bytes.byteLength;
    }
    if (capError) continue;

    if (outFiles.length > PER_SKILL_FILES) {
      errors.push({
        name: meta.name,
        message: `exceeds the ${PER_SKILL_FILES}-file per-skill limit`,
      });
      continue;
    }
    if (total > PER_SKILL_MAX) {
      errors.push({ name: meta.name, message: 'exceeds the 10 MiB per-skill size limit' });
      continue;
    }

    nameToCount.set(meta.name, (nameToCount.get(meta.name) ?? 0) + 1);
    built.push({ name: meta.name, description: meta.description, files: outFiles });
  }

  // 5. Intra-scope name collision: a name claimed by >1 skill resolves to none.
  const skills: DetectedSkill[] = [];
  const reportedCollision = new Set<string>();
  for (const skill of built) {
    if ((nameToCount.get(skill.name) ?? 0) > 1) {
      if (!reportedCollision.has(skill.name)) {
        errors.push({
          name: skill.name,
          message: `multiple skills resolve to the name "${skill.name}"`,
        });
        reportedCollision.add(skill.name);
      }
      continue;
    }
    skills.push(skill);
  }

  return { skills, errors };
}

/**
 * Zip a detected skill into a cleaned, normalized archive. `sizeBytes` is the
 * sum of uncompressed entry lengths; `fileCount` is the entry count (incl.
 * SKILL.md). A fixed mtime makes identical content produce an identical blob.
 */
export function normalizeArchive(detected: DetectedSkill): {
  archive: Uint8Array;
  sizeBytes: number;
  fileCount: number;
} {
  const zippable: Zippable = {};
  let sizeBytes = 0;
  for (const f of detected.files) {
    zippable[f.path] = f.bytes;
    sizeBytes += f.bytes.byteLength;
  }
  const archive = zipSync(zippable, { mtime: FIXED_MTIME });
  return { archive, sizeBytes, fileCount: detected.files.length };
}
