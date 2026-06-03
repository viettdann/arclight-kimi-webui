import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Per-user key-value settings. Composite PK (user_id, key). Rows appear only
 * when a user saves a value — nothing is seeded. Absent keys fall back to
 * site-level or code defaults at the read site.
 */
export const userSettings = pgTable('user_settings', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.key] }),
]);
