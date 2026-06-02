import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { PROJECT_DISCOVERY_MODES } from 'shared/types';
import { user } from './auth';

/**
 * Per-user project discovery blacklist settings. Controls which directory names
 * are excluded when scanning `<WORKSPACE_ROOT>/<slug(userEmail)>/` for projects.
 *
 *   entries  text[] of directory names to blacklist
 *   mode     'append' merges entries with the built-in default blacklist;
 *            'override' replaces the default entirely.
 */
export const projectDiscoverySettings = pgTable('project_discovery_settings', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(),
  entries: text('entries').array().notNull().default([]),
  mode: text('mode', { enum: [...PROJECT_DISCOVERY_MODES] }).notNull().default('append'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type ProjectDiscoverySettingsRow = typeof projectDiscoverySettings.$inferSelect;
export type NewProjectDiscoverySettingsRow = typeof projectDiscoverySettings.$inferInsert;
