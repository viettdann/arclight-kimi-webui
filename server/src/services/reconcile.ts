import { readdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { type DB, schema } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { logger } from '../lib/logger';

const CLONE_MARKER_PREFIX = '.cloning-';

/**
 * Remove folders left behind by a clone that was interrupted (process killed
 * mid-fetch). The route writes a `.cloning-<slug>` marker beside the target dir
 * for the clone's lifetime and removes it on any terminal outcome. Since clones
 * live only in this process, every marker found at startup is by definition
 * stale: delete the half-cloned folder and the marker. Best-effort throughout —
 * a failure here never blocks boot.
 */
export async function cleanupInterruptedClones(workspaceRoot: string): Promise<void> {
  let userDirs: string[];
  try {
    userDirs = (await readdir(workspaceRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return; // workspace root not created yet — nothing to reconcile
  }

  await Promise.all(
    userDirs.map(async (userDir) => {
      const userRoot = path.join(workspaceRoot, userDir);
      let markers: string[];
      try {
        markers = (await readdir(userRoot))
          .filter((name) => name.startsWith(CLONE_MARKER_PREFIX))
          .map((name) => name.slice(CLONE_MARKER_PREFIX.length));
      } catch {
        return;
      }
      await Promise.all(
        markers.map(async (slug) => {
          const projectDir = path.join(userRoot, slug);
          const markerPath = path.join(userRoot, `${CLONE_MARKER_PREFIX}${slug}`);
          logger.warn({ projectDir }, 'cleaning interrupted clone folder');
          await rm(projectDir, { recursive: true, force: true }).catch(() => {});
          await rm(markerPath, { force: true }).catch(() => {});
        }),
      );
    }),
  );
}

/**
 * Mark every session row as `idle`. SDK and WebSocket state is in-memory and
 * does not survive a restart, so nothing is genuinely "active" at boot — any
 * row left `active` (or in any other transient state) by the previous process
 * is stale. Reset them all so listings reflect reality. Logs the affected count.
 */
async function markAllActiveAsIdle(db: DB): Promise<void> {
  const updated = await db
    .update(schema.sessions)
    .set({ status: 'idle' })
    .returning({ id: schema.sessions.id });

  logger.info({ count: updated.length }, 'reconcile: reset all sessions to idle');
}

/**
 * Bring in-memory-dependent state back to a consistent baseline at startup.
 * Resets all session rows to `idle` (nothing survives a restart) and clears any
 * partial clone folders. Transcript catch-up is intentionally absent: the live
 * consumer mirrors per-turn and restore is lazy on resume.
 */
export async function reconcileOnStartup({
  db,
  env = defaultEnv,
}: {
  db: DB;
  env?: Pick<Env, 'WORKSPACE_ROOT'>;
}): Promise<void> {
  logger.info('Running reconcileOnStartup...');

  await markAllActiveAsIdle(db);
  await cleanupInterruptedClones(env.WORKSPACE_ROOT);
}
