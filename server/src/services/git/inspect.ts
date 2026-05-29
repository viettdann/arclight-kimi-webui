import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectGitInfo } from 'shared/types';
import { type GitRunResult, runGit } from './run';

const DEFAULT_TIMEOUT_MS = 4_000;

// A sub-command "succeeded" only when it exited 0 and wasn't killed by the
// timeout. Spawn failure (exitCode -1) and timeout both fall through to the
// caller's null/0 fallback.
const succeeded = (r: GitRunResult): boolean => r.exitCode === 0 && !r.timedOut;

/**
 * Cheap git snapshot of `dir`: current branch, count of uncommitted changes,
 * and the `origin` remote URL. Returns `null` when `dir` has no `.git` (a blank
 * project, or not a repo). Never throws — failed sub-commands degrade to
 * `null`/`0` fields so the delete dialog still renders.
 *
 * The remote URL is the clean clone URL: tokens are injected out-of-band via an
 * HTTP header during clone (see `git/clone.ts`), never persisted into the
 * remote, so it's safe to surface.
 */
export async function inspectRepo(
  dir: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ProjectGitInfo | null> {
  try {
    // `.git` is a dir for clones, a file for worktrees/submodules — existence
    // is enough to treat `dir` as a repo.
    await stat(path.join(dir, '.git'));
  } catch {
    return null;
  }

  const [branchR, statusR, remoteR] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeoutMs, captureStdout: true }),
    runGit(['status', '--porcelain'], { cwd: dir, timeoutMs, captureStdout: true }),
    runGit(['remote', 'get-url', 'origin'], { cwd: dir, timeoutMs, captureStdout: true }),
  ]);

  const branch = succeeded(branchR) ? branchR.stdout.trim() || null : null;
  const dirtyCount = succeeded(statusR)
    ? statusR.stdout.split('\n').filter((l) => l.trim().length > 0).length
    : 0;
  const remote = succeeded(remoteR) ? remoteR.stdout.trim() || null : null;

  return { branch, dirtyCount, remote };
}
