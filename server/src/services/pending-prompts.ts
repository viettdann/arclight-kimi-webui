import { eq } from 'drizzle-orm';
import { type DB, db as defaultDb, schema } from '../db';

export async function enqueuePendingPrompt(
  sessionId: string,
  text: string,
  db?: DB,
): Promise<void> {
  const dbh = db ?? defaultDb;
  await dbh
    .update(schema.sessions)
    .set({
      pendingPrompt: text,
      pendingEnqueuedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
}

export async function clearPendingPrompt(sessionId: string, db?: DB): Promise<void> {
  const dbh = db ?? defaultDb;
  await dbh
    .update(schema.sessions)
    .set({
      pendingPrompt: null,
      pendingEnqueuedAt: null,
    })
    .where(eq(schema.sessions.id, sessionId));
}

export async function peekPendingPrompt(
  sessionId: string,
  db?: DB,
): Promise<{ text: string; enqueuedAt: Date } | null> {
  const dbh = db ?? defaultDb;
  const rows = await dbh
    .select({
      pendingPrompt: schema.sessions.pendingPrompt,
      pendingEnqueuedAt: schema.sessions.pendingEnqueuedAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));

  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  if (!row?.pendingPrompt || !row.pendingEnqueuedAt) return null;

  return {
    text: row.pendingPrompt,
    enqueuedAt: row.pendingEnqueuedAt,
  };
}
