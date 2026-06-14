import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import type { DB } from '../../db';
import { logger } from '../../lib/logger';
import { getSkillArchive, listEnabledSkillMeta } from './store';

const MANIFEST_FILE = '.skills-manifest.json';

type Manifest = Record<string, string>; // skill name -> change signature

/** An enabled skill to materialize: canonical name, a cheap change `signature`
 *  (unchanged signature + present dir → skip), and a lazy archive loader called
 *  only when materialization is actually needed. */
export interface MaterializableSkill {
  name: string;
  signature: string;
  loadArchive: () => Promise<Uint8Array>;
}

async function readManifest(path: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Manifest;
    }
  } catch {
    // Missing or corrupt → start fresh; the reconcile below rebuilds it.
  }
  return {};
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unzip an archive into `destDir`, rejecting any entry that escapes it. Throws
 * on a zip-slip attempt (absolute path or `..` traversal) before writing it.
 */
export async function unpackArchive(archive: Uint8Array, destDir: string): Promise<void> {
  const entries = unzipSync(archive);
  for (const [entryPath, bytes] of Object.entries(entries)) {
    if (entryPath.endsWith('/')) continue; // directory entry
    // Zip-slip guard: the resolved target must stay within destDir.
    if (isAbsolute(entryPath) || entryPath.split('/').includes('..')) {
      throw new Error(`unsafe archive entry path: ${entryPath}`);
    }
    const target = resolve(destDir, entryPath);
    const rel = relative(destDir, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`archive entry escapes skill dir: ${entryPath}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

/**
 * Reconcile a `skills/` dir against the set of skills that should be present:
 *
 * - Materialize each skill whose signature changed (or whose dir is missing)
 *   into `skills/<name>/`, zip-slip guarded. The archive is loaded lazily, so
 *   unchanged skills never pull their blob.
 * - Prune any `skills/<name>` dir not in `enabled` — this is what makes a
 *   disabled or deleted skill disappear without touching the DB row.
 * - Track signatures in `skills/.skills-manifest.json` and only rewrite on change.
 *
 * Per-skill failures are isolated: one bad archive logs and is skipped without
 * blocking the others.
 */
export async function reconcileSkillsDir(
  skillsDir: string,
  enabled: MaterializableSkill[],
): Promise<void> {
  const enabledNames = new Set(enabled.map((s) => s.name));
  const manifestPath = join(skillsDir, MANIFEST_FILE);

  await mkdir(skillsDir, { recursive: true });
  const manifest = await readManifest(manifestPath);
  let changed = false;

  // Materialize skills whose signature changed or whose dir is gone.
  for (const skill of enabled) {
    const dir = join(skillsDir, skill.name);
    if (manifest[skill.name] === skill.signature && (await dirExists(dir))) continue;
    try {
      const archive = await skill.loadArchive();
      await rm(dir, { recursive: true, force: true });
      await unpackArchive(archive, dir);
      manifest[skill.name] = skill.signature;
      changed = true;
    } catch (err) {
      logger.warn({ err, skill: skill.name }, 'failed to materialize skill; skipping');
    }
  }

  // Prune on-disk dirs not backed by an enabled skill.
  let dirEntries: string[] = [];
  try {
    dirEntries = await readdir(skillsDir);
  } catch {
    dirEntries = [];
  }
  for (const entry of dirEntries) {
    if (entry === MANIFEST_FILE) continue;
    if (!enabledNames.has(entry)) {
      await rm(join(skillsDir, entry), { recursive: true, force: true });
    }
  }
  // Prune stale manifest keys.
  for (const name of Object.keys(manifest)) {
    if (!enabledNames.has(name)) {
      delete manifest[name];
      changed = true;
    }
  }

  if (changed) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }
}

/**
 * Materialize a user's enabled skills into `${configDir}/skills`. The SDK
 * subprocess discovers skills from this dir once, at process init — not per turn
 * — so this must run before each `query()` spawn (see `startQuery`). The dir is
 * tmpfs and wiped on restart, so every spawn re-materializes from the DB.
 *
 * Best-effort: any failure is logged and swallowed so it never aborts the turn.
 */
export async function restoreSkillsForUser(
  db: DB,
  userId: string,
  configDir: string,
): Promise<void> {
  try {
    const meta = await listEnabledSkillMeta(db, userId);
    await reconcileSkillsDir(
      join(configDir, 'skills'),
      meta.map((m) => ({
        name: m.name,
        signature: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : String(m.updatedAt),
        loadArchive: async () => {
          const archive = await getSkillArchive(db, userId, m.id);
          if (!archive) throw new Error(`archive missing for skill ${m.name}`);
          return archive;
        },
      })),
    );
  } catch (err) {
    logger.warn({ err, userId }, 'restoreSkillsForUser failed; continuing turn without it');
  }
}
