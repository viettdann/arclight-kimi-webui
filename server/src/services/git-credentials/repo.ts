import { and, desc, eq } from 'drizzle-orm';
import type { GitProvider } from 'shared/types/git-credentials';
import type { DB } from '../../db';
import { type GitCredentialRow, gitCredentials } from '../../db/schema';

export async function listForUser(db: DB, userId: string): Promise<GitCredentialRow[]> {
  return db
    .select()
    .from(gitCredentials)
    .where(eq(gitCredentials.userId, userId))
    .orderBy(desc(gitCredentials.createdAt));
}

export async function getOwned(
  db: DB,
  userId: string,
  id: string,
): Promise<GitCredentialRow | null> {
  const rows = await db
    .select()
    .from(gitCredentials)
    .where(and(eq(gitCredentials.id, id), eq(gitCredentials.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function create(
  db: DB,
  userId: string,
  input: { label: string; provider: GitProvider; token: string },
): Promise<GitCredentialRow> {
  const now = new Date();
  const values = {
    userId,
    label: input.label,
    provider: input.provider,
    token: input.token,
    createdAt: now,
    updatedAt: now,
  };
  const rows = await db.insert(gitCredentials).values(values).returning();
  return rows[0] as GitCredentialRow;
}

export async function update(
  db: DB,
  userId: string,
  id: string,
  patch: { label?: string; provider?: GitProvider; token?: string },
): Promise<GitCredentialRow | null> {
  const existing = await getOwned(db, userId, id);
  if (!existing) return null;

  const set: Partial<GitCredentialRow> = {};
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.provider !== undefined) set.provider = patch.provider;
  if (patch.token !== undefined && patch.token.length > 0) set.token = patch.token;

  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date();
    await db
      .update(gitCredentials)
      .set(set)
      .where(and(eq(gitCredentials.id, id), eq(gitCredentials.userId, userId)));
  }

  return { ...existing, ...set } as GitCredentialRow;
}

export async function remove(db: DB, userId: string, id: string): Promise<boolean> {
  const existing = await getOwned(db, userId, id);
  if (!existing) return false;
  await db
    .delete(gitCredentials)
    .where(and(eq(gitCredentials.id, id), eq(gitCredentials.userId, userId)));
  return true;
}
