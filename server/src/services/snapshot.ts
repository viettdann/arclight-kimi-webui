import { asc, eq } from 'drizzle-orm';
import type { MessageDTO, MessageRole, SessionStatus, SnapshotPayload } from 'shared/types';
import { type DB, db, schema } from '../db';

// Build a wire-shape snapshot for `subscribe` / `resume_session` paths.
// Reads `sessions` + ordered `messages` for one session and maps to the DTO
// shapes the client already understands.

export interface BuildSnapshotArgs {
  sessionId: string;
  db?: DB;
}

export async function buildSnapshot(args: BuildSnapshotArgs): Promise<SnapshotPayload | null> {
  const dbh = args.db ?? db;

  const [sessRow] = await dbh
    .select({
      status: schema.sessions.status,
      totalTokens: schema.sessions.totalTokens,
      title: schema.sessions.title,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, args.sessionId))
    .limit(1);
  if (!sessRow) return null;

  const messageRows = await dbh
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, args.sessionId))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));

  const messages: MessageDTO[] = messageRows.map((row) => ({
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    toolName: row.toolName,
    toolInput: row.toolInput ?? null,
    isError: row.isError ?? null,
    thinking: row.thinking,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    messages,
    status: sessRow.status as SessionStatus,
    totalTokens: sessRow.totalTokens,
    title: sessRow.title,
  };
}
