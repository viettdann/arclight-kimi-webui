import { eq } from 'drizzle-orm';
import { type DB, db as defaultDb, schema } from '../db';

export async function enqueuePendingPrompt(
  sessionId: string,
  text: string,
  db?: DB,
): Promise<void> {
  const dbh = db ?? defaultDb;
  await dbh
    .update(schema.kimiSessions)
    .set({
      pendingPrompt: text,
      pendingEnqueuedAt: new Date(),
    })
    .where(eq(schema.kimiSessions.id, sessionId));
}

export async function clearPendingPrompt(sessionId: string, db?: DB): Promise<void> {
  const dbh = db ?? defaultDb;
  await dbh
    .update(schema.kimiSessions)
    .set({
      pendingPrompt: null,
      pendingEnqueuedAt: null,
    })
    .where(eq(schema.kimiSessions.id, sessionId));
}

export async function peekPendingPrompt(
  sessionId: string,
  db?: DB,
): Promise<{ text: string; enqueuedAt: Date } | null> {
  const dbh = db ?? defaultDb;
  const rows = await dbh
    .select({
      pendingPrompt: schema.kimiSessions.pendingPrompt,
      pendingEnqueuedAt: schema.kimiSessions.pendingEnqueuedAt,
    })
    .from(schema.kimiSessions)
    .where(eq(schema.kimiSessions.id, sessionId));

  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  if (!row?.pendingPrompt || !row.pendingEnqueuedAt) return null;

  return {
    text: row.pendingPrompt,
    enqueuedAt: row.pendingEnqueuedAt,
  };
}
