import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

export const kimiSessions = pgTable(
  'kimi_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workDir: text('workDir').notNull(),
    projectName: varchar('projectName', { length: 255 }).notNull(),
    title: varchar('title', { length: 255 }),
    model: varchar('model', { length: 100 }),
    thinking: boolean('thinking').notNull().default(false),
    yoloMode: boolean('yoloMode').notNull().default(false),
    approvalMode: text('approvalMode').notNull().default('ask'),
    kimiSessionId: varchar('kimiSessionId', { length: 100 }),
    totalTokens: integer('totalTokens').notNull().default(0),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    lastActiveAt: timestamp('lastActiveAt', { mode: 'date' }).notNull().defaultNow(),
    pendingPrompt: text('pendingPrompt'),
    pendingEnqueuedAt: timestamp('pendingEnqueuedAt', { mode: 'date' }),
  },
  (t) => [index('kimi_sessions_user_idx').on(t.userId, t.lastActiveAt.desc())],
);

export const kimiSessionFiles = pgTable('kimi_session_files', {
  sessionId: uuid('sessionId')
    .primaryKey()
    .references(() => kimiSessions.id, { onDelete: 'cascade' }),
  wireJsonl: text('wireJsonl').notNull().default(''),
  contextJsonl: text('contextJsonl').notNull().default(''),
  stateJson: text('stateJson').notNull().default(''),
  wireByteOffset: integer('wireByteOffset').notNull().default(0),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export type KimiSession = typeof kimiSessions.$inferSelect;
export type NewKimiSession = typeof kimiSessions.$inferInsert;
export type KimiSessionFile = typeof kimiSessionFiles.$inferSelect;
export type NewKimiSessionFile = typeof kimiSessionFiles.$inferInsert;
