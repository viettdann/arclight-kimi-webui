import { bigserial, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';

/**
 * One row per JSONL transcript entry mirrored from the SDK `SessionStore`.
 * Ordering is by the monotonic `id`. The table is generic (no FK to `sessions`)
 * so the conformance suite can exercise it with arbitrary keys; deletion on
 * session/project removal is handled at the app layer by `deleteStoreEntries`.
 *
 *   project_key      caller scope (= sanitized cwd; matches `encodeCwd`)
 *   sdk_session_id   the SDK session UUID (globally unique)
 *   subpath          NULL = main transcript; `subagents/agent-<id>` = subagent
 *   entry            the JSONL line as a pass-through POJO
 *   entry_uuid       entry.uuid when present, for idempotent re-append
 */
export const sessionStoreEntries = pgTable(
  'session_store_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectKey: text('project_key').notNull(),
    sdkSessionId: text('sdk_session_id').notNull(),
    subpath: text('subpath'),
    entry: jsonb('entry').notNull().$type<SessionStoreEntry>(),
    entryUuid: text('entry_uuid'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // load / render: scan a session's entries (main or a subpath) in id order.
    index('session_store_entries_load_idx').on(t.sdkSessionId, t.subpath, t.id),
    // listSessions: group a project's main transcripts.
    index('session_store_entries_list_idx').on(t.projectKey, t.sdkSessionId),
    // Idempotency: re-append of an entry that carries a uuid is a no-op.
    // coalesce(subpath,'') makes a NULL (main) subpath comparable for uniqueness;
    // the partial predicate skips uuid-less entries (titles/tags) from dedup.
    uniqueIndex('session_store_entries_idem_idx')
      .on(t.projectKey, t.sdkSessionId, sql`coalesce(${t.subpath}, '')`, t.entryUuid)
      .where(sql`${t.entryUuid} IS NOT NULL`),
  ],
);

export type SessionStoreEntryRow = typeof sessionStoreEntries.$inferSelect;
export type NewSessionStoreEntryRow = typeof sessionStoreEntries.$inferInsert;
