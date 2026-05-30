import { desc, eq } from 'drizzle-orm';
import type { AvailableProvidersResponse } from 'shared/types/providers';
import { OAUTH_DEFAULT_MODEL } from 'shared/types/providers';
import type { DB } from '../../db';
import type { ProviderRow } from '../../db/schema';
import { user } from '../../db/schema/auth';
import { sessions } from '../../db/schema/sessions';
import { getProviderRow, listBuiltinRows, listOwnerRows, toDTO } from './store';

export class ProviderUnavailableError extends Error {
  constructor(message = 'Provider unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

async function getUserRole(db: DB, userId: string): Promise<'admin' | 'user' | null> {
  const rows = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
  return (rows[0]?.role as 'admin' | 'user') ?? null;
}

export async function resolveProviderForUser(
  db: DB,
  userId: string,
  providerId: string | null,
): Promise<ProviderRow | null> {
  if (!providerId) return null;

  const result = await getProviderRow(db, providerId);
  if (!result) return null;

  const { provider } = result;

  // Builtin (ownerUserId IS NULL)
  if (provider.ownerUserId === null) {
    if (provider.visibility === 'public') return provider;
    const role = await getUserRole(db, userId);
    if (role === 'admin') return provider;
    return null;
  }

  // Personal
  if (provider.ownerUserId === userId) return provider;
  return null;
}

export async function listAvailableForUser(
  db: DB,
  userId: string,
): Promise<AvailableProvidersResponse> {
  const role = await getUserRole(db, userId);
  const builtinRows =
    role === 'admin' ? await listBuiltinRows(db) : await listBuiltinRows(db, { publicOnly: true });

  const personalRows = await listOwnerRows(db, userId);

  return {
    builtin: builtinRows.map(({ provider, models }) => toDTO(provider, models)),
    personal: personalRows.map(({ provider, models }) => toDTO(provider, models)),
  };
}

export async function defaultSelectionForUser(
  db: DB,
  userId: string,
): Promise<{ providerId: string; model: string } | null> {
  // (1) Most-recent session with a provider + model
  const recentSessions = await db
    .select({ providerId: sessions.providerId, model: sessions.model })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastActiveAt))
    .limit(1);

  const recent = recentSessions[0];
  if (recent?.providerId && recent?.model) {
    const resolved = await resolveProviderForUser(db, userId, recent.providerId);
    if (resolved) {
      return { providerId: recent.providerId, model: recent.model };
    }
  }

  // (2) Most-recent personal oauth provider
  const personalRows = await listOwnerRows(db, userId);
  const oauthRow = personalRows.find((r) => r.provider.type === 'oauth');
  if (oauthRow) {
    return { providerId: oauthRow.provider.id, model: OAUTH_DEFAULT_MODEL };
  }

  return null;
}
