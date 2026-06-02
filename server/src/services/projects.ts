import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_PROJECT_DISCOVERY_BLACKLIST } from 'shared/types';
import type { ProjectStatResponse, ProjectSummary } from 'shared/types';
import { slug } from '../auth';
import { type DB, schema } from '../db';
import type { Env } from '../env';
import { type auditLog as defaultAuditLog, logger } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';
import { isUnderWorkspace } from './agent/agent-paths';
import { deleteStoreEntries } from './agent/session-store';
import { projectTranscriptDir } from './agent/transcript-store';
import { cloningProjectNamesForUser } from './git/clone-registry';
import { inspectRepo } from './git/inspect';
import { teardownActiveSession } from './session-lifecycle';
import type { SessionManager } from './session-manager';

/** Default blacklist for project discovery. */
const DEFAULT_BLACKLIST = new Set(DEFAULT_PROJECT_DISCOVERY_BLACKLIST);

/** Check if a directory name matches any blacklist entry (exact match or prefix with /). */
function isBlacklisted(name: string, blacklist: Set<string>): boolean {
  for (const entry of blacklist) {
    if (name === entry) return true;
    if (entry.endsWith('/') && name.startsWith(entry)) return true;
  }
  return false;
}

/** Build the effective blacklist for a user. */
async function buildBlacklist(db: DB, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      entries: schema.projectDiscoverySettings.entries,
      mode: schema.projectDiscoverySettings.mode,
    })
    .from(schema.projectDiscoverySettings)
    .where(eq(schema.projectDiscoverySettings.userId, userId));

  if (rows.length === 0) {
    return new Set(DEFAULT_BLACKLIST);
  }

  const row = rows[0]!;
  const entries = row.entries ?? [];
  const mode = row.mode;

  if (mode === 'override') {
    return new Set(entries);
  }

  // append mode: merge defaults + DB entries, deduplicate
  return new Set([...DEFAULT_BLACKLIST, ...entries]);
}

export interface ListProjectsForUserArgs {
  userId: string;
  userEmail: string;
  db: DB;
  env: Pick<Env, 'WORKSPACE_ROOT'>;
}

/**
 * Returns the union of:
 *   - directories under `<WORKSPACE_ROOT>/<slug(userEmail)>/` (origin=local)
 *   - `sessions.projectName` values that don't have a corresponding local
 *     folder yet (origin=foreign).
 *
 * Owns the `mkdir -p userRoot` step so callers don't have to. Output is sorted
 * by `Intl.Collator({ numeric: true })` on `name`.
 *
 * Filters out directories matching the user's project discovery blacklist.
 */
export async function listProjectsForUser({
  userId,
  userEmail,
  db,
  env,
}: ListProjectsForUserArgs): Promise<ProjectSummary[]> {
  const userRoot = path.join(env.WORKSPACE_ROOT, slug(userEmail));
  // Build blacklist first (cheap single-row lookup) so the subsequent FS+DB
  // work can run concurrently.
  const blacklist = await buildBlacklist(db, userId);
  // DB query has no FS dependency, so it runs concurrently with mkdir+readdir.
  // readdir still serialises behind mkdir (ENOENT otherwise).
  const dbRowsP = db
    .selectDistinct({ projectName: schema.sessions.projectName })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
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
    if (isBlacklisted(d.name, blacklist)) continue;
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
    if (isBlacklisted(name, blacklist)) continue;
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

/** Thrown when no `sessions` rows match `(userId, projectName)`. */
export class ProjectNotFoundError extends Error {
  constructor(projectName: string) {
    super(`project not found: ${projectName}`);
    this.name = 'ProjectNotFoundError';
  }
}

/**
 * Adopt every `sessions` row matching (userId, projectName) onto the local
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
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.projectName, projectName)));
  if (rows.length === 0) throw new ProjectNotFoundError(projectName);

  const workDir = path.join(env.WORKSPACE_ROOT, userSlug, projectName);
  await mkdir(workDir, { recursive: true, mode: 0o700 });

  await db
    .update(schema.sessions)
    .set({ workDir })
    .where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.projectName, projectName)));

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
  manager: SessionManager;
  auditLog: typeof defaultAuditLog;
}

/**
 * Hard-delete a project and every session under it, in a crash-safe order:
 *
 *   1. Tear down any in-memory sessions so the SDK stops writing first.
 *   2. **DB-first**: `DELETE sessions WHERE (userId, projectName)`, then drop the
 *      sessions' mirrored `session_store_entries` by SDK id. Past this point the
 *      project can no longer be restored from the DB.
 *   3. Best-effort disk cleanup: each recorded workDir's transcript dir under
 *      `CLAUDE_CONFIG_DIR/projects/<enc(cwd)>`, then the project folder under
 *      the user root (the user's real code).
 *
 * Step 3 is best-effort (logged, non-fatal): the authoritative deletion already
 * completed in step 2, and any residue is inert and removed by a retry.
 *
 * Existence = DB rows **or** a local folder, so a retry after a partial
 * (crashed) prior delete still cleans up the leftover folder — self-healing,
 * no tombstone needed. Returns `'not_found'` when neither exists.
 *
 * Disk removal only ever touches local-derived paths: the project folder is
 * path-guarded, and transcript dirs are encoded from the recorded workDir, so a
 * foreign session's remote `workDir` only ever maps to a (non-existent) encoded
 * dir name — never `rm`-ed as a raw path.
 */
export async function deleteProjectForUser({
  userId,
  userEmail,
  projectName,
  db,
  env,
  manager,
  auditLog,
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
      id: schema.sessions.id,
      workDir: schema.sessions.workDir,
      sdkSessionId: schema.sessions.sdkSessionId,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.projectName, projectName)));

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

  // 2. DB-first authoritative delete, then drop each session's mirrored store
  //    entries (generic table, no FK cascade) keyed by SDK session id.
  if (rows.length > 0) {
    await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.projectName, projectName)));
    try {
      await deleteStoreEntries(
        db,
        rows.map((r) => r.sdkSessionId).filter((v): v is string => v != null),
      );
    } catch (err) {
      logger.warn({ err, projectName }, 'deleteProject: failed to remove session store entries');
    }
  }

  // 3a. Best-effort: remove the per-cwd transcript dirs the claude binary wrote.
  // Each dir is independent; remove them concurrently. Per-item try/catch keeps
  // the batch best-effort (one failure never rejects the rest). Foreign/remote
  // workDirs that live outside the workspace never had a local transcript dir
  // (the binary only ran for in-workspace cwds), so skip them.
  const workDirs = new Set<string>(
    [localWorkDir, ...rows.map((r) => r.workDir)].filter((wd) => isUnderWorkspace(wd)),
  );
  await Promise.all(
    [...workDirs].map(async (wd) => {
      const dir = projectTranscriptDir(wd);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ err, projectName, dir }, 'deleteProject: failed to remove transcript dir');
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

  auditLog({ userId, action: 'project_delete', path: projectName, bytes: 0 });
  return { sessionCount: rows.length };
}
