import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Generic key-value store for site-wide (admin) settings. Rows appear only when
 * an admin saves a value — nothing is seeded. Absent keys fall back to the
 * code defaults at the read site. `value` is jsonb so a single column holds any
 * shape (boolean toggles, string arrays, nested objects).
 */
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SiteSettingRow = typeof siteSettings.$inferSelect;
export type NewSiteSettingRow = typeof siteSettings.$inferInsert;
