import {
  boolean,
  index,
  integer,
  jsonb,
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
    title: varchar('title', { length: 255 }),
    model: varchar('model', { length: 100 }),
    thinking: boolean('thinking').notNull().default(false),
    yoloMode: boolean('yoloMode').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    kimiSessionId: varchar('kimiSessionId', { length: 100 }),
    totalTokens: integer('totalTokens').notNull().default(0),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    lastActiveAt: timestamp('lastActiveAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.status, t.lastActiveAt.desc())],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('sessionId')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content'),
    toolName: varchar('toolName', { length: 100 }),
    toolInput: jsonb('toolInput'),
    /** Tool-result rows only: did the tool throw / return error. Null elsewhere. */
    isError: boolean('isError'),
    thinking: text('thinking'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('messages_session_idx').on(t.sessionId, t.createdAt)],
);

export const sessionFiles = pgTable('session_files', {
  sessionId: uuid('sessionId')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workDirHash: varchar('workDirHash', { length: 32 }).notNull(),
  wireJsonl: text('wireJsonl').notNull().default(''),
  contextJsonl: text('contextJsonl').notNull().default(''),
  stateJson: text('stateJson').notNull().default(''),
  wireByteOffset: integer('wireByteOffset').notNull().default(0),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type SessionFile = typeof sessionFiles.$inferSelect;
export type NewSessionFile = typeof sessionFiles.$inferInsert;
