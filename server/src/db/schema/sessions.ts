import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { providers } from './providers';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workDir: text().notNull(),
    projectName: varchar({ length: 255 }).notNull(),
    title: varchar({ length: 255 }),
    model: varchar({ length: 100 }),
    providerId: uuid().references(() => providers.id, { onDelete: 'set null' }),
    thinking: boolean().notNull().default(false),
    approvalMode: text().notNull().default('ask'), // ask | safe | bypass
    sdkSessionId: varchar({ length: 100 }),
    status: text().notNull().default('idle'), // active | idle | error
    totalTokens: integer().notNull().default(0),
    totalCostUsd: numeric({ precision: 10, scale: 6 }).notNull().default('0'),
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    lastActiveAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    pendingPrompt: text(),
    pendingEnqueuedAt: timestamp({ mode: 'date' }),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.lastActiveAt.desc())],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
