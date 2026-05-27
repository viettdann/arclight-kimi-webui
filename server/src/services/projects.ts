import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { ProjectSummary } from 'shared/types';
import { slug } from '../auth';
import { type DB, schema } from '../db';
import type { Env } from '../env';

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

  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    byName.set(d.name, {
      name: d.name,
      workDir: path.join(userRoot, d.name),
      origin: 'local',
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
