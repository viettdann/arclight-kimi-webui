import type { DB } from '../../db';
import { logger } from '../../lib/logger';
import type { SessionManager } from '../session-manager';
import { listSkills } from '../skills/store';
import { applySkillsToCatalog } from './commands-catalog';
import { disposeQuery } from './query-runner';

// Propagate a user's skill change (upload / enable-toggle / delete) into their
// live sessions. Skills are re-materialized and re-discovered only when a fresh
// subprocess spawns, so a long-lived subprocess never sees a mid-session change.
// This bridges that gap WITHOUT eagerly spawning a subprocess:
//   1. Overlay the new skill set onto each session's catalog and broadcast it,
//      so the picker accepts `/skill` immediately.
//   2. Dispose each idle subprocess so the NEXT turn respawns and actually loads
//      the skills from disk. A mid-turn session is flagged `skillsDirty` instead
//      (disposing it would abort the running turn); `ensureQuery` respawns it
//      before the following turn.

const log = logger.child({ module: 'agent/skill-sync' });

/**
 * Refresh every in-memory session owned by `userId` after their skills changed.
 * Best-effort and never throws — a refresh failure must not fail the HTTP write
 * that triggered it.
 */
export async function syncSkillsForUser(
  manager: SessionManager,
  db: DB,
  userId: string,
): Promise<void> {
  try {
    const sessions = manager
      .listForUser(userId)
      .map((id) => manager.peek(id))
      .filter((a): a is NonNullable<typeof a> => a !== null);
    if (sessions.length === 0) return;

    const enabled = (await listSkills(db, userId)).filter((s) => s.enabled);

    for (const active of sessions) {
      applySkillsToCatalog(active, enabled, manager);
      if (!active.query) continue;
      if (active.turnInProgress) {
        // Can't restart mid-turn; defer to the next ensureQuery.
        active.skillsDirty = true;
      } else {
        await disposeQuery(active);
      }
    }
  } catch (err) {
    log.warn({ err, userId }, 'syncSkillsForUser failed; continuing');
  }
}
