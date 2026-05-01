import { and, gt, inArray, sql } from 'drizzle-orm';
import { type DB, db as defaultDb, schema } from '../db';

// Auth session validation against BetterAuth `session` table. `expires_at`
// is the authoritative expiration column (`server/src/db/schema/auth.ts:24`).
// Single-instance design — direct DB lookup, no caching beyond the per-WS
// `lastValidatedAt` shortcut owned by callers.

/** Bulk variant. Returns the set of ids whose `expires_at > now()`. */
export async function validateAuthSessions(
  ids: readonly string[],
  db: DB = defaultDb,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(
      and(inArray(schema.session.id, ids as string[]), gt(schema.session.expiresAt, sql`now()`)),
    );
  return new Set(rows.map((r) => r.id));
}

/** Single-id convenience. Hits the same query path as the heartbeat batch. */
export async function validateAuthSession(id: string, db: DB = defaultDb): Promise<boolean> {
  if (!id) return false;
  const valid = await validateAuthSessions([id], db);
  return valid.has(id);
}
