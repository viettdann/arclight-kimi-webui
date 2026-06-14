import { and, asc, eq } from 'drizzle-orm';
import type { SkillDTO } from 'shared/types';
import type { DB } from '../../db';
import { type SkillRow, skills } from '../../db/schema';

/** Serialize a row for the client; the `archive` blob is never sent. */
export function toDTO(row: SkillRow): SkillDTO {
  const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    fileCount: row.fileCount,
    sizeBytes: row.sizeBytes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export interface UpsertSkillInput {
  name: string;
  description: string;
  archive: Uint8Array;
  sizeBytes: number;
  fileCount: number;
}

/**
 * Insert a new `(owner, name)` skill (enabled), or replace the archive /
 * description / counts of an existing one while preserving its `enabled` flag.
 */
export async function upsertSkill(
  db: DB,
  userId: string,
  input: UpsertSkillInput,
): Promise<{ action: 'created' | 'updated' }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.ownerUserId, userId), eq(skills.name, input.name)))
      .limit(1);

    if (existing[0]) {
      await tx
        .update(skills)
        .set({
          description: input.description,
          archive: input.archive,
          sizeBytes: input.sizeBytes,
          fileCount: input.fileCount,
          // `enabled` is intentionally not touched: a re-upload of a disabled
          // skill stays disabled.
        })
        .where(eq(skills.id, existing[0].id));
      return { action: 'updated' as const };
    }

    await tx.insert(skills).values({
      ownerUserId: userId,
      name: input.name,
      description: input.description,
      enabled: true,
      fileCount: input.fileCount,
      sizeBytes: input.sizeBytes,
      archive: input.archive,
    });
    return { action: 'created' as const };
  });
}

/** All of a user's skills, ordered by name. */
export function listSkills(db: DB, userId: string): Promise<SkillRow[]> {
  return db.select().from(skills).where(eq(skills.ownerUserId, userId)).orderBy(asc(skills.name));
}

/** Metadata of a user's enabled skills — no `archive` blob. `updatedAt` is the
 *  restore signature: it bumps on every upsert/toggle, so restore can detect a
 *  change without loading (and re-hashing) every archive each turn. */
export interface EnabledSkillMeta {
  id: string;
  name: string;
  updatedAt: Date | string;
}

export function listEnabledSkillMeta(db: DB, userId: string): Promise<EnabledSkillMeta[]> {
  return db
    .select({ id: skills.id, name: skills.name, updatedAt: skills.updatedAt })
    .from(skills)
    .where(and(eq(skills.ownerUserId, userId), eq(skills.enabled, true)))
    .orderBy(asc(skills.name));
}

/** Load one owned skill's archive bytes, or null if absent. */
export async function getSkillArchive(
  db: DB,
  userId: string,
  id: string,
): Promise<Uint8Array | null> {
  const rows = await db
    .select({ archive: skills.archive })
    .from(skills)
    .where(and(eq(skills.id, id), eq(skills.ownerUserId, userId)))
    .limit(1);
  return rows[0]?.archive ?? null;
}

/** Toggle `enabled`; returns false if the user owns no such row. */
export async function setEnabled(
  db: DB,
  userId: string,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  const updated = await db
    .update(skills)
    .set({ enabled })
    .where(and(eq(skills.id, id), eq(skills.ownerUserId, userId)))
    .returning({ id: skills.id });
  return updated.length > 0;
}

/** Delete an owned skill; returns false if the user owns no such row. */
export async function deleteSkill(db: DB, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(skills)
    .where(and(eq(skills.id, id), eq(skills.ownerUserId, userId)))
    .returning({ id: skills.id });
  return deleted.length > 0;
}
