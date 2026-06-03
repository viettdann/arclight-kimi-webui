import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';
import { type SQL, sql } from 'drizzle-orm';
import { db } from '../../db/index';

/**
 * Minimal structural seam over a Drizzle database. Both the production
 * postgres-js `db` and a test `drizzle(pglite)` satisfy it. The two drivers
 * return `execute()` results in different shapes (postgres-js → a `RowList`
 * array; pglite → a `{ rows }` object), so {@link rowsOf} normalizes them.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Normalize a driver-specific `execute()` result to a plain row array. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** A subagent transcript subpath looks like `subagents/agent-<id>`. */
export type SubagentEntries = Map<string, SessionStoreEntry[]>;

/**
 * Postgres-backed `SessionStore`: one row per JSONL entry, ordered by the
 * monotonic `id`. Mirrors the SDK transcript dual-write — the SDK calls
 * `append()` after each local write, and `load()` once before resume to
 * rematerialize the local JSONL from the DB.
 *
 * `listSessionSummaries` is intentionally unimplemented; `listSessions()` is
 * exercised only by the conformance suite (the app reads by `sdk_session_id`).
 */
export function createSessionStore(exec: SqlExecutor): SessionStore {
  return {
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      if (entries.length === 0) return;
      const subpath = key.subpath ?? null;
      const rows = entries.map((e) => {
        const uuid = typeof e.uuid === 'string' ? e.uuid : null;
        return sql`(${key.projectKey}, ${key.sessionId}, ${subpath}, ${JSON.stringify(e)}::jsonb, ${uuid})`;
      });
      // Explicit partial-index arbiter: uuid-bearing entries dedup on replay;
      // uuid-less entries (titles/tags) don't match the predicate and always insert.
      await exec.execute(sql`
        INSERT INTO session_store_entries (project_key, sdk_session_id, subpath, entry, entry_uuid)
        VALUES ${sql.join(rows, sql`, `)}
        ON CONFLICT (project_key, sdk_session_id, coalesce(subpath, ''), entry_uuid)
          WHERE entry_uuid IS NOT NULL DO NOTHING
      `);
    },

    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      const subpath = key.subpath ?? null;
      const result = await exec.execute(sql`
        SELECT entry FROM session_store_entries
        WHERE project_key = ${key.projectKey}
          AND sdk_session_id = ${key.sessionId}
          AND subpath IS NOT DISTINCT FROM ${subpath}
        ORDER BY id
      `);
      const rows = rowsOf(result);
      return rows.length > 0 ? rows.map((r) => r.entry as SessionStoreEntry) : null;
    },

    async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
      const result = await exec.execute(sql`
        SELECT sdk_session_id AS "sessionId",
               (extract(epoch from max(created_at)) * 1000)::bigint AS mtime
        FROM session_store_entries
        WHERE project_key = ${projectKey} AND subpath IS NULL
        GROUP BY sdk_session_id
      `);
      return rowsOf(result).map((r) => ({
        sessionId: r.sessionId as string,
        mtime: Number(r.mtime),
      }));
    },

    async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
      const result = await exec.execute(sql`
        SELECT DISTINCT subpath FROM session_store_entries
        WHERE project_key = ${key.projectKey}
          AND sdk_session_id = ${key.sessionId}
          AND subpath IS NOT NULL
      `);
      return rowsOf(result).map((r) => r.subpath as string);
    },

    async delete(key: SessionKey): Promise<void> {
      if (key.subpath === undefined) {
        // Whole-session delete cascades into every subpath.
        await exec.execute(sql`
          DELETE FROM session_store_entries
          WHERE project_key = ${key.projectKey} AND sdk_session_id = ${key.sessionId}
        `);
      } else {
        await exec.execute(sql`
          DELETE FROM session_store_entries
          WHERE project_key = ${key.projectKey}
            AND sdk_session_id = ${key.sessionId}
            AND subpath = ${key.subpath}
        `);
      }
    },
  };
}

/** Production singleton, wired to the postgres-js `db`. */
export const sessionStore = createSessionStore(db);

/**
 * App-side read keyed by `sdk_session_id` (globally unique, so no projectKey
 * filter is needed). Returns the main transcript entries plus a per-subpath map
 * of subagent entries, both in append order — the shape `renderEntries` and the
 * snapshot path consume.
 */
export async function readSessionEntries(
  exec: SqlExecutor,
  sdkSessionId: string,
): Promise<{ main: SessionStoreEntry[]; subagents: SubagentEntries }> {
  const result = await exec.execute(sql`
    SELECT subpath, entry FROM session_store_entries
    WHERE sdk_session_id = ${sdkSessionId}
    ORDER BY id
  `);
  const main: SessionStoreEntry[] = [];
  const subagents: SubagentEntries = new Map();
  for (const r of rowsOf(result)) {
    const subpath = r.subpath as string | null;
    const entry = r.entry as SessionStoreEntry;
    if (subpath == null) {
      main.push(entry);
    } else {
      const list = subagents.get(subpath);
      if (list) list.push(entry);
      else subagents.set(subpath, [entry]);
    }
  }
  return { main, subagents };
}

/**
 * Remove every entry for the given SDK session ids (main + all subpaths).
 * Called on session/project deletion in place of the FK cascade the old
 * `session_transcripts` table had. No-op for an empty list.
 */
export async function deleteStoreEntries(
  exec: SqlExecutor,
  sdkSessionIds: string[],
): Promise<void> {
  const ids = sdkSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return;
  // Expand to `IN ($1, $2, …)` of scalar params rather than `= ANY($1)` of one
  // array param: array wire-encoding is driver-specific (postgres-js encodes a
  // JS array; the pglite driver does not), so the scalar list keeps this query
  // portable across both — the seam {@link SqlExecutor} promises.
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  await exec.execute(sql`
    DELETE FROM session_store_entries WHERE sdk_session_id IN (${list})
  `);
}
