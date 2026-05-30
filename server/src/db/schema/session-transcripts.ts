import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sessions } from './sessions';

export const sessionTranscripts = pgTable('session_transcripts', {
  sessionId: uuid()
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  sdkSessionId: varchar({ length: 100 }),
  workspaceCwd: text().notNull(),
  content: text().notNull().default(''),
  byteOffset: integer().notNull().default(0),
  subagents: jsonb(),
  updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
});

export type SessionTranscript = typeof sessionTranscripts.$inferSelect;
export type NewSessionTranscript = typeof sessionTranscripts.$inferInsert;
