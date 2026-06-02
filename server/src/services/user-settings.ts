import { and, eq, inArray, sql } from 'drizzle-orm';
import { type DB, schema } from '../db';

export const USER_SETTING_KEYS = {
  sessionProviderId: 'session_defaults.provider_id',
  sessionModel: 'session_defaults.model',
  sessionThinking: 'session_defaults.thinking',
  sessionApprovalMode: 'session_defaults.approval_mode',
  sessionEffort: 'session_defaults.effort',
} as const;

/** Read ALL user settings rows for a given user. */
export async function readAll(db: DB, userId: string): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: schema.userSettings.key, value: schema.userSettings.value })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  return new Map(rows.map((r) => [r.key, r.value]));
}

/**
 * Batch upsert user settings. Entries with `value === null` are deleted.
 * Others are inserted or updated via onConflictDoUpdate.
 */
export async function batchUpsert(
  db: DB,
  entries: { key: string; value: unknown }[],
  userId: string,
): Promise<void> {
  const toDelete = entries.filter((e) => e.value === null);
  const toUpsert = entries.filter((e) => e.value !== null);

  await Promise.all([
    toDelete.length > 0
      ? db.delete(schema.userSettings).where(
          and(
            eq(schema.userSettings.userId, userId),
            inArray(
              schema.userSettings.key,
              toDelete.map((e) => e.key),
            ),
          ),
        )
      : Promise.resolve(),
    toUpsert.length > 0
      ? db
          .insert(schema.userSettings)
          .values(
            toUpsert.map((e) => ({
              userId,
              key: e.key,
              value: e.value,
            })),
          )
          .onConflictDoUpdate({
            target: [schema.userSettings.userId, schema.userSettings.key],
            set: { value: sql`excluded.value`, updatedAt: sql`now()` },
          })
      : Promise.resolve(),
  ]);
}

/**
 * Get session defaults for a user from user_settings.
 * Returns only values that are explicitly set (no code defaults here —
 * those are applied at the route level via cascading resolution).
 */
export async function getSessionDefaults(
  db: DB,
  userId: string,
): Promise<{
  providerId: string | null;
  model: string | null;
  thinking: boolean | null;
  approvalMode: string | null;
  effort: string | null;
}> {
  const values = await readAll(db, userId);

  const providerId =
    typeof values.get(USER_SETTING_KEYS.sessionProviderId) === 'string'
      ? (values.get(USER_SETTING_KEYS.sessionProviderId) as string)
      : null;

  const model =
    typeof values.get(USER_SETTING_KEYS.sessionModel) === 'string'
      ? (values.get(USER_SETTING_KEYS.sessionModel) as string)
      : null;

  const thinkingRaw = values.get(USER_SETTING_KEYS.sessionThinking);
  const thinking = typeof thinkingRaw === 'boolean' ? thinkingRaw : null;

  const approvalMode =
    typeof values.get(USER_SETTING_KEYS.sessionApprovalMode) === 'string'
      ? (values.get(USER_SETTING_KEYS.sessionApprovalMode) as string)
      : null;

  const effort =
    typeof values.get(USER_SETTING_KEYS.sessionEffort) === 'string'
      ? (values.get(USER_SETTING_KEYS.sessionEffort) as string)
      : null;

  return { providerId, model, thinking, approvalMode, effort };
}
