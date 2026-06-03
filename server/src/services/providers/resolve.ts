import { desc, eq } from 'drizzle-orm';
import type { AvailableProvidersResponse } from 'shared/types/providers';
import type { DB } from '../../db';
import type { ProviderModelRow, ProviderRow } from '../../db/schema';
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

/**
 * Built-in providers in the scope a user may use: an admin sees every built-in,
 * a non-admin only public ones. Single source of truth for the role→visibility
 * rule shared by the composer catalog (`listAvailableForUser`) and the
 * session-default fallback (`defaultSelectionForUser`) so the two never drift.
 */
async function listBuiltinRowsForUser(
  db: DB,
  userId: string,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] }[]> {
  const role = await getUserRole(db, userId);
  return role === 'admin' ? listBuiltinRows(db) : listBuiltinRows(db, { publicOnly: true });
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
  const builtinRows = await listBuiltinRowsForUser(db, userId);

  const personalRows = await listOwnerRows(db, userId);

  return {
    builtin: builtinRows.map(({ provider, models }) => toDTO(provider, models)),
    personal: personalRows.map(({ provider, models }) => toDTO(provider, models)),
  };
}

/** Selection rule shared by the personal and built-in fallbacks. */
function pickDefaultModel(models: ProviderModelRow[]): string | null {
  const chosen = models.find((m) => m.isDefault) ?? models[0];
  return chosen?.modelId ?? null;
}

export async function defaultSelectionForUser(
  db: DB,
  userId: string,
): Promise<{ providerId: string; model: string } | null> {
  // (1) Most-recent session whose pinned (providerId, model) still resolves.
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

  // (2) Personal providers (any type), newest first; first with >=1 model.
  // oauth providers persist OAUTH_MODELS into provider_models on create, so the
  // generic model-pick covers them just like api providers.
  const personalRows = await listOwnerRows(db, userId);
  for (const { provider, models } of personalRows) {
    const model = pickDefaultModel(models);
    if (model) return { providerId: provider.id, model };
  }

  // (3) Built-in providers, newest first; first with >=1 model. Same role→scope
  // rule as the composer catalog: an admin may default to a private built-in, a
  // non-admin only to public ones. Without this an admin-only built-in shows in
  // the composer dropdown yet never auto-pins, so a fresh session sends with a
  // null provider → `provider_unset`.
  const builtinRows = await listBuiltinRowsForUser(db, userId);
  for (const { provider, models } of builtinRows) {
    const model = pickDefaultModel(models);
    if (model) return { providerId: provider.id, model };
  }

  // (4) Nothing usable.
  return null;
}
