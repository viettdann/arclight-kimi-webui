import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: text(),
  isSecret: boolean().notNull().default(false),
  updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
