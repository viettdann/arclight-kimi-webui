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

export const sessions = pgTable(
  'sessions',
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
    status: varchar('status', { length: 20 }).notNull().default('active'),
    kimiSessionId: varchar('kimiSessionId', { length: 100 }),
    totalTokens: integer('totalTokens').notNull().default(0),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    lastActiveAt: timestamp('lastActiveAt', { mode: 'date' }).notNull().defaultNow(),
    pendingPrompt: text('pendingPrompt'),
    pendingEnqueuedAt: timestamp('pendingEnqueuedAt', { mode: 'date' }),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.status, t.lastActiveAt.desc())],
);

export const sessionFiles = pgTable('session_files', {
  sessionId: uuid('sessionId')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  wireJsonl: text('wireJsonl').notNull().default(''),
  contextJsonl: text('contextJsonl').notNull().default(''),
  stateJson: text('stateJson').notNull().default(''),
  wireByteOffset: integer('wireByteOffset').notNull().default(0),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionFile = typeof sessionFiles.$inferSelect;
export type NewSessionFile = typeof sessionFiles.$inferInsert;
