import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  ProviderDTO,
  ProviderModelDTO,
  ProviderModelInput,
  ProviderScope,
  ProviderType,
  Visibility,
} from 'shared/types/providers';
import type { DB } from '../../db';
import {
  type ProviderModelRow,
  type ProviderRow,
  providerModels,
  providers,
  sessions,
} from '../../db/schema';
import { maskApiKey } from '../git-credentials/mask';

/**
 * Owner scope for a mutating call. `{ ownerUserId }` restricts the WHERE clause
 * to a single user's Personal provider; `{ builtin: true }` restricts it to
 * Built-in rows (`owner_user_id IS NULL`). The scope is folded into the query
 * so a caller that forgot a prior ownership check cannot mutate the wrong row.
 */
export type ProviderScopeFilter = { ownerUserId: string } | { builtin: true };

function scopeWhere(scope: ProviderScopeFilter) {
  return 'ownerUserId' in scope
    ? eq(providers.ownerUserId, scope.ownerUserId)
    : isNull(providers.ownerUserId);
}

/** Dedupe model inputs by `modelId`, last occurrence wins. */
function dedupeModels(models: ProviderModelInput[]): ProviderModelInput[] {
  const byId = new Map<string, ProviderModelInput>();
  for (const m of models) byId.set(m.modelId, m);
  return [...byId.values()];
}

export function toDTO(provider: ProviderRow, models: ProviderModelRow[]): ProviderDTO {
  const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));
  const scope: ProviderScope = provider.ownerUserId === null ? 'builtin' : 'personal';
  return {
    id: provider.id,
    scope,
    type: provider.type as ProviderType,
    visibility: (provider.visibility as Visibility | null) ?? null,
    namespace: provider.namespace,
    baseUrl: provider.baseUrl ?? null,
    tokenMasked: maskApiKey(provider.token),
    models: models.map(
      (m): ProviderModelDTO => ({
        id: m.id,
        modelId: m.modelId,
        displayName: m.displayName ?? null,
        contextWindow: m.contextWindow ?? null,
        isDefault: m.isDefault,
      }),
    ),
    createdAt: iso(provider.createdAt),
    updatedAt: iso(provider.updatedAt),
  };
}

export async function getProviderRow(
  db: DB,
  id: string,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] } | null> {
  const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
  const provider = rows[0];
  if (!provider) return null;
  const models = await db.select().from(providerModels).where(eq(providerModels.providerId, id));
  return { provider, models };
}

async function fetchModelsForProviders(
  db: DB,
  providerRows: ProviderRow[],
): Promise<Map<string, ProviderModelRow[]>> {
  const map = new Map<string, ProviderModelRow[]>();
  if (providerRows.length === 0) return map;
  const ids = providerRows.map((p) => p.id);
  const allModels = await db
    .select()
    .from(providerModels)
    .where(inArray(providerModels.providerId, ids));
  for (const m of allModels) {
    const arr = map.get(m.providerId) ?? [];
    arr.push(m);
    map.set(m.providerId, arr);
  }
  return map;
}

export async function listBuiltinRows(
  db: DB,
  opts?: { publicOnly?: boolean },
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] }[]> {
  const baseWhere = isNull(providers.ownerUserId);
  const where = opts?.publicOnly ? and(baseWhere, eq(providers.visibility, 'public')) : baseWhere;

  const rows = await db.select().from(providers).where(where).orderBy(desc(providers.createdAt));

  const modelsMap = await fetchModelsForProviders(db, rows);
  return rows.map((provider) => ({ provider, models: modelsMap.get(provider.id) ?? [] }));
}

export async function listOwnerRows(
  db: DB,
  userId: string,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] }[]> {
  const rows = await db
    .select()
    .from(providers)
    .where(eq(providers.ownerUserId, userId))
    .orderBy(desc(providers.createdAt));

  const modelsMap = await fetchModelsForProviders(db, rows);
  return rows.map((provider) => ({ provider, models: modelsMap.get(provider.id) ?? [] }));
}

export async function getOwned(
  db: DB,
  userId: string,
  id: string,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] } | null> {
  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.ownerUserId, userId)))
    .limit(1);
  const provider = rows[0];
  if (!provider) return null;
  const models = await db.select().from(providerModels).where(eq(providerModels.providerId, id));
  return { provider, models };
}

export async function getBuiltin(
  db: DB,
  id: string,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] } | null> {
  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), isNull(providers.ownerUserId)))
    .limit(1);
  const provider = rows[0];
  if (!provider) return null;
  const models = await db.select().from(providerModels).where(eq(providerModels.providerId, id));
  return { provider, models };
}

export interface CreateProviderInput {
  ownerUserId: string | null;
  type: ProviderType;
  visibility: Visibility | null;
  namespace: string;
  baseUrl: string | null;
  token: string;
  models: ProviderModelInput[];
}

export async function createProvider(
  db: DB,
  input: CreateProviderInput,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] }> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const inserted = await tx
      .insert(providers)
      .values({
        ownerUserId: input.ownerUserId,
        type: input.type,
        visibility: input.visibility,
        namespace: input.namespace,
        baseUrl: input.baseUrl,
        token: input.token,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const provider = inserted[0] as ProviderRow;

    const modelInputs = dedupeModels(input.models);
    let models: ProviderModelRow[] = [];
    if (modelInputs.length > 0) {
      models = await tx
        .insert(providerModels)
        .values(
          modelInputs.map((m) => ({
            providerId: provider.id,
            modelId: m.modelId,
            displayName: m.displayName ?? null,
            contextWindow: m.contextWindow ?? null,
            isDefault: m.isDefault ?? false,
          })),
        )
        .returning();
    }

    return { provider, models };
  });
}

export interface UpdateProviderPatch {
  namespace?: string;
  baseUrl?: string | null;
  visibility?: Visibility;
  token?: string;
  models?: ProviderModelInput[];
}

export async function updateProvider(
  db: DB,
  id: string,
  patch: UpdateProviderPatch,
  scope: ProviderScopeFilter,
): Promise<{ provider: ProviderRow; models: ProviderModelRow[] } | null> {
  return db.transaction(async (tx) => {
    const idWhere = and(eq(providers.id, id), scopeWhere(scope));
    const existing = await tx.select().from(providers).where(idWhere).limit(1);
    if (!existing[0]) return null;

    const set: Partial<ProviderRow> = {};
    if (patch.namespace !== undefined) set.namespace = patch.namespace;
    if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl;
    if (patch.visibility !== undefined) set.visibility = patch.visibility;
    if (patch.token !== undefined && patch.token.length > 0) set.token = patch.token;

    let provider: ProviderRow = existing[0];
    if (Object.keys(set).length > 0) {
      set.updatedAt = new Date();
      const updated = await tx.update(providers).set(set).where(idWhere).returning();
      provider = updated[0] as ProviderRow;
    }

    let models: ProviderModelRow[];
    if (patch.models !== undefined) {
      const modelInputs = dedupeModels(patch.models);
      await tx.delete(providerModels).where(eq(providerModels.providerId, id));
      if (modelInputs.length > 0) {
        models = await tx
          .insert(providerModels)
          .values(
            modelInputs.map((m) => ({
              providerId: id,
              modelId: m.modelId,
              displayName: m.displayName ?? null,
              contextWindow: m.contextWindow ?? null,
              isDefault: m.isDefault ?? false,
            })),
          )
          .returning();
      } else {
        models = [];
      }
    } else {
      models = await tx.select().from(providerModels).where(eq(providerModels.providerId, id));
    }

    return { provider, models };
  });
}

export async function removeProvider(
  db: DB,
  id: string,
  scope: ProviderScopeFilter,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Clear any half-pinned session model before the provider FK nulls
    // `providerId`: a row keyed on this provider must not keep a stale model.
    await tx.update(sessions).set({ model: null }).where(eq(sessions.providerId, id));

    const deleted = await tx
      .delete(providers)
      .where(and(eq(providers.id, id), scopeWhere(scope)))
      .returning();
    return deleted.length > 0;
  });
}
