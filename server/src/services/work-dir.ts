import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { slug } from '../auth';

export interface ResolveWorkDirArgs {
  userEmail: string;
  projectName: string;
  env: { WORKSPACE_ROOT: string };
}

/**
 * Logical → absolute workDir for the current machine.
 *
 * `slug(userEmail)` matches the dir layout the auth `databaseHooks` create at
 * sign-up. Pure function: given `(email, projectName, env)`, the output is the
 * canonical local path under `WORKSPACE_ROOT`, irrespective of any per-row
 * cache in the DB.
 */
export function resolveWorkDir(args: ResolveWorkDirArgs): string {
  return path.join(args.env.WORKSPACE_ROOT, slug(args.userEmail), args.projectName);
}

/** mkdir -p with mode 0o700. Idempotent. */
export async function ensureWorkDir(absPath: string): Promise<void> {
  await mkdir(absPath, { recursive: true, mode: 0o700 });
}

/**
 * First path segment under `userRoot`. Returns `null` for empty rel, parent
 * escapes (`..`), absolute mismatches, and `userRoot` itself.
 */
export function deriveProjectName(userRoot: string, workDir: string): string | null {
  const rel = path.relative(userRoot, workDir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const seg = rel.split(path.sep)[0];
  if (!seg || seg === '..' || seg === '.') return null;
  return seg;
}
