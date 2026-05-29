import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { ProjectStatResponse, ProjectSummary } from 'shared/types';
import { slug } from '../auth';
import { type DB, schema } from '../db';
import type { Env } from '../env';
import { type auditLog as defaultAuditLog, logger } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';
import { cloningProjectNamesForUser } from './git/clone-registry';
import { inspectRepo } from './git/inspect';
import { kimiPaths } from './kimi-config/paths';
import { resolveShareDir } from './kimi-config/share-dir';
import { removeKimiMetadata } from './kimi-config/share-metadata';
import { teardownActiveSession } from './session-lifecycle';
import type { KimiSessionManager } from './session-manager';

export interface ListProjectsForUserArgs {
  userId: string;
  userEmail: string;
  db: DB;
  env: Pick<Env, 'WORKSPACE_ROOT'>;
}

/**
 * Returns the union of:
 *   - directories under `<WORKSPACE_ROOT>/<slug(userEmail)>/` (origin=local)
 *   - `kimi_sessions.projectName` values that don't have a corresponding local
 *     folder yet (origin=foreign).
 *
 * Owns the `mkdir -p userRoot` step so callers don't have to. Output is sorted
 * by `Intl.Collator({ numeric: true })` on `name`.
 */
export async function listProjectsForUser({
  userId,
  userEmail,
  db,
  env,
}: ListProjectsForUserArgs): Promise<ProjectSummary[]> {
  const userRoot = path.join(env.WORKSPACE_ROOT, slug(userEmail));
  // DB query has no FS dependency, so it runs concurrently with mkdir+readdir.
  // readdir still serialises behind mkdir (ENOENT otherwise).
  const dbRowsP = db
    .selectDistinct({ projectName: schema.kimiSessions.projectName })
    .from(schema.kimiSessions)
    .where(eq(schema.kimiSessions.userId, userId));
  await mkdir(userRoot, { recursive: true, mode: 0o700 });
  const [dirents, dbRows] = await Promise.all([
    readdir(userRoot, { withFileTypes: true }),
    dbRowsP,
  ]);

  const byName = new Map<string, ProjectSummary>();
  // In-flight clones (this process) so a still-filling folder shows as `cloning`
  // in the sidebar after a refresh / in another tab, not as a ready project.
  const cloning = cloningProjectNamesForUser(userId);

  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    byName.set(d.name, {
      name: d.name,
      workDir: path.join(userRoot, d.name),
      origin: 'local',
      status: cloning.has(d.name) ? 'cloning' : 'ready',
    });
  }

  for (const r of dbRows) {
    const name = r.projectName;
    if (byName.has(name)) continue;
    byName.set(name, {
      name,
      workDir: path.join(userRoot, name),
      origin: 'foreign',
    });
  }

  const collator = new Intl.Collator(undefined, { numeric: true });
  return Array.from(byName.values()).sort((a, b) => collator.compare(a.name, b.name));
}

export interface AdoptProjectForUserArgs {
  userId: string;
  /** Pre-computed `slug(email)` — auth/upgrade already did this once. */
  userSlug: string;
  projectName: string;
  db: DB;
  env: Pick<Env, 'WORKSPACE_ROOT'>;
}

export interface AdoptProjectResult {
  projectName: string;
  workDir: string;
  sessionCount: number;
}

/** Thrown when no `kimi_sessions` rows match `(userId, projectName)`. */
export class ProjectNotFoundError extends Error {
  constructor(projectName: string) {
    super(`project not found: ${projectName}`);
    this.name = 'ProjectNotFoundError';
  }
}

/**
 * Adopt every `kimi_sessions` row matching (userId, projectName) onto the local
 * machine: materialise the project folder under `<WORKSPACE_ROOT>/<slug>/`,
 * then cascade-rewrite each sibling row's `workDir` to the local path.
 *
 * Throws `ProjectNotFoundError` when no rows exist for (userId, projectName) —
 * the project must already exist in the DB before it can be adopted.
 */
export async function adoptProjectForUser({
  userId,
  userSlug,
  projectName,
  db,
  env,
}: AdoptProjectForUserArgs): Promise<AdoptProjectResult> {
  const rows = await db
    .select({ id: schema.kimiSessions.id })
    .from(schema.kimiSessions)
    .where(
      and(eq(schema.kimiSessions.userId, userId), eq(schema.kimiSessions.projectName, projectName)),
    );
  if (rows.length === 0) throw new ProjectNotFoundError(projectName);

  const workDir = path.join(env.WORKSPACE_ROOT, userSlug, projectName);
  await mkdir(workDir, { recursive: true, mode: 0o700 });

  await db
    .update(schema.kimiSessions)
    .set({ workDir })
    .where(
      and(eq(schema.kimiSessions.userId, userId), eq(schema.kimiSessions.projectName, projectName)),
    );

  return { projectName, workDir, sessionCount: rows.length };
}

export interface StatProjectForUserArgs {
  userEmail: string;
  projectName: string;
  env: Pick<Env, 'WORKSPACE_ROOT'>;
}

/**
 * Lazy on-disk snapshot of a project's local folder for the delete dialog:
 * existence, top-level entry count, and a cheap git summary. Path-guarded
 * against traversal — a name that escapes the user root reports
 * `exists:false`. Foreign (not-yet-adopted) projects have no local folder, so
 * they report `{ exists:false, entryCount:0, git:null }` and delete becomes a
 * DB-only operation. Never scans recursively (no folder-size cost).
 */
export async function statProjectForUser({
  userEmail,
  projectName,
  env,
}: StatProjectForUserArgs): Promise<ProjectStatResponse> {
  const userRoot = path.join(env.WORKSPACE_ROOT, slug(userEmail));

  let dir: string;
  try {
    dir = await resolveUserPath(userRoot, projectName);
  } catch {
    return { exists: false, entryCount: 0, git: null };
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { exists: false, entryCount: 0, git: null };
  }

  const git = await inspectRepo(dir);
  return { exists: true, entryCount: entries.length, git };
}

export interface DeleteProjectForUserArgs {
  userId: string;
  userEmail: string;
  projectName: string;
  db: DB;
  env: Pick<Env, 'WORKSPACE_ROOT'>;
  manager: KimiSessionManager;
  auditLog: typeof defaultAuditLog;
  /** Override the Kimi share dir (tests). Defaults to `resolveShareDir()`. */
  shareDir?: string;
}

/**
 * Hard-delete a project and every session under it, in the only crash-safe
 * order for a wire-first restore model:
 *
 *   1. Tear down any in-memory sessions so the SDK stops writing first.
 *   2. **DB-first**: `DELETE kimi_sessions WHERE (userId, projectName)` — one
 *      atomic statement; `kimi_session_files` (the JSONL restore source) goes
 *      via ON DELETE CASCADE. Past this point `restoreFromBackup` can no longer
 *      resurrect the project.
 *   3. Best-effort disk cleanup: each session's `.kimi/sessions/<hash>` dir,
 *      then the project folder under the user root (the user's real code).
 *   4. Best-effort `kimi.json` cleanup: drop the local workDir entry plus any
 *      distinct session workDirs.
 *
 * Steps 3–4 are best-effort (logged, non-fatal): the authoritative deletion
 * already completed in step 2, and any residue is inert and removed by a retry.
 *
 * Existence = DB rows **or** a local folder, so a retry after a partial
 * (crashed) prior delete still cleans up the leftover folder — self-healing,
 * no tombstone needed. Returns `'not_found'` when neither exists.
 *
 * Disk removal only ever touches local-derived paths (`kimiPaths().sessionDir`
 * is always under the local `.kimi/sessions/<md5(workDir)>`, and the project
 * folder is path-guarded), so a foreign session's remote `workDir` string is
 * never `rm`-ed directly.
 */
export async function deleteProjectForUser({
  userId,
  userEmail,
  projectName,
  db,
  env,
  manager,
  auditLog,
  shareDir,
}: DeleteProjectForUserArgs): Promise<{ sessionCount: number } | 'not_found'> {
  const userRoot = path.join(env.WORKSPACE_ROOT, slug(userEmail));

  // Resolve+guard the local folder up front. A traversal attempt ('..', abs)
  // can't name a real project, so treat it as not_found.
  let localWorkDir: string;
  try {
    localWorkDir = await resolveUserPath(userRoot, projectName);
  } catch {
    return 'not_found';
  }

  const rows = await db
    .select({
      id: schema.kimiSessions.id,
      workDir: schema.kimiSessions.workDir,
      kimiSessionId: schema.kimiSessions.kimiSessionId,
    })
    .from(schema.kimiSessions)
    .where(
      and(eq(schema.kimiSessions.userId, userId), eq(schema.kimiSessions.projectName, projectName)),
    );

  // Existence = DB rows OR a local folder. Only stat the folder when there are
  // no rows — that's the only case where the folder decides not_found. The
  // common has-rows path skips the syscall (it removes the folder unconditionally
  // later regardless).
  if (rows.length === 0) {
    const folderExists = await stat(localWorkDir)
      .then(() => true)
      .catch(() => false);
    if (!folderExists) return 'not_found';
  }

  // 1. Tear down in-memory sessions (interrupt → drain backup → SDK close) so
  //    nothing keeps writing to disk/DB while we delete.
  for (const r of rows) {
    const active = manager.getForUser(userId, r.id);
    if (active != null) {
      await teardownActiveSession(active, { manager, db });
    }
  }

  // 2. DB-first authoritative delete. CASCADE removes kimi_session_files.
  if (rows.length > 0) {
    await db
      .delete(schema.kimiSessions)
      .where(
        and(
          eq(schema.kimiSessions.userId, userId),
          eq(schema.kimiSessions.projectName, projectName),
        ),
      );
  }

  // 3a. Best-effort: per-session on-disk Kimi runtime dirs.
  // Each session dir is an independent path; remove them concurrently. Per-item
  // try/catch keeps the batch best-effort (one failure never rejects the rest).
  const paths = kimiPaths();
  await Promise.all(
    rows.map(async (r) => {
      if (!r.kimiSessionId) return;
      const sessionDir = paths.sessionDir(r.workDir, r.kimiSessionId);
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn(
          { err, projectName, sessionDir },
          'deleteProject: failed to remove session dir',
        );
      }
    }),
  );

  // 3b. Best-effort: the project folder (the user's real working files).
  try {
    await rm(localWorkDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      { err, projectName, localWorkDir },
      'deleteProject: failed to remove project folder',
    );
  }

  // 4. Best-effort: drop kimi.json entries (local workDir + any session workDirs).
  const resolvedShareDir = shareDir ?? resolveShareDir();
  const workDirs = new Set<string>([localWorkDir, ...rows.map((r) => r.workDir)]);
  for (const wd of workDirs) {
    try {
      await removeKimiMetadata(resolvedShareDir, wd);
    } catch (err) {
      logger.warn(
        { err, projectName, workDir: wd },
        'deleteProject: failed to remove kimi.json entry',
      );
    }
  }

  auditLog({ userId, action: 'project_delete', path: projectName, bytes: 0 });
  return { sessionCount: rows.length };
}
