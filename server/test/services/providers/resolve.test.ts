import { describe, expect, it, mock } from 'bun:test';
import { OAUTH_DEFAULT_MODEL, OAUTH_MODELS } from 'shared/types/providers';
import type { DB } from '../../../src/db';
import type { ProviderModelRow, ProviderRow } from '../../../src/db/schema';

// ─────────────────────────── Store mock ───────────────────────────
//
// Must be declared before the dynamic import of the module under test so
// mock.module registers before the ESM binding is resolved.

const mockGetProviderRow = mock(
  async (_db: DB, _id: string) =>
    null as { provider: ProviderRow; models: ProviderModelRow[] } | null,
);
const mockListBuiltinRows = mock(
  async (_db: DB, _opts?: { publicOnly?: boolean }) =>
    [] as { provider: ProviderRow; models: ProviderModelRow[] }[],
);
const mockListOwnerRows = mock(
  async (_db: DB, _userId: string) => [] as { provider: ProviderRow; models: ProviderModelRow[] }[],
);
const mockToDTO = mock((provider: ProviderRow, models: ProviderModelRow[]) => ({
  id: provider.id,
  scope: (provider.ownerUserId === null ? 'builtin' : 'personal') as 'builtin' | 'personal',
  type: provider.type as 'oauth' | 'api',
  visibility: provider.visibility as 'public' | 'private' | null,
  namespace: provider.namespace,
  baseUrl: provider.baseUrl ?? null,
  tokenMasked: `***${provider.token.slice(-4)}`,
  models: models.map((m) => ({
    id: m.id,
    modelId: m.modelId,
    displayName: m.displayName ?? null,
    contextWindow: m.contextWindow ?? null,
    isDefault: m.isDefault,
  })),
  createdAt:
    provider.createdAt instanceof Date
      ? provider.createdAt.toISOString()
      : String(provider.createdAt),
  updatedAt:
    provider.updatedAt instanceof Date
      ? provider.updatedAt.toISOString()
      : String(provider.updatedAt),
}));

mock.module('../../../src/services/providers/store', () => ({
  getProviderRow: mockGetProviderRow,
  listBuiltinRows: mockListBuiltinRows,
  listOwnerRows: mockListOwnerRows,
  toDTO: mockToDTO,
}));

const { resolveProviderForUser, listAvailableForUser, defaultSelectionForUser } = await import(
  '../../../src/services/providers/resolve'
);

// ─────────────────────────── Helpers ───────────────────────────

const NOW = new Date('2026-01-01T00:00:00Z');

function makeProvider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'prov-1',
    ownerUserId: null,
    type: 'api',
    visibility: 'public',
    namespace: 'TestNS',
    baseUrl: null,
    token: 'tok-abcd1234',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeModel(overrides: Partial<ProviderModelRow> = {}): ProviderModelRow {
  return {
    id: 'mod-1',
    providerId: 'prov-1',
    modelId: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    contextWindow: 200_000,
    isDefault: true,
    ...overrides,
  };
}

// ─────────────────────────── DB fakes ───────────────────────────
//
// resolve.ts calls:
//   db.select({ role }).from(user).where(...).limit(1)  → getUserRole
//   db.select({ providerId, model }).from(sessions).where(...).orderBy(...).limit(1) → defaultSelectionForUser
//
// The chain: select(...).from(t).where(.).limit(n) → array.
// We must support `.where().limit()` returning a Promise.

function makeFakeDbForRole(role: 'admin' | 'user' | null): DB {
  const fake = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(role !== null ? [{ role }] : []),
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
        orderBy: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  };
  return fake as unknown as DB;
}

function makeFakeDbWithSession(
  role: 'admin' | 'user' | null,
  session: { providerId: string; model: string } | null,
): DB {
  const fake = {
    select: (_projection?: unknown) => ({
      from: (_table: unknown) => ({
        where: () => ({
          limit: () => {
            // First call is getUserRole query; subsequent calls go through orderBy
            return Promise.resolve(role !== null ? [{ role }] : []);
          },
          orderBy: () => ({
            limit: () => Promise.resolve(session !== null ? [session] : []),
          }),
        }),
        orderBy: () => ({
          limit: () => Promise.resolve(session !== null ? [session] : []),
        }),
      }),
    }),
  };
  return fake as unknown as DB;
}

// ─────────────────────────── resolveProviderForUser ───────────────────────────

describe('resolveProviderForUser', () => {
  it('returns null when providerId is null', async () => {
    const db = makeFakeDbForRole('user');
    const result = await resolveProviderForUser(db, 'user-1', null);
    expect(result).toBeNull();
  });

  it('returns null when provider not found in store', async () => {
    mockGetProviderRow.mockResolvedValueOnce(null);
    const db = makeFakeDbForRole('user');
    const result = await resolveProviderForUser(db, 'user-1', 'missing-id');
    expect(result).toBeNull();
  });

  it('builtin public → allowed for non-admin user', async () => {
    const prov = makeProvider({ ownerUserId: null, visibility: 'public' });
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });
    const db = makeFakeDbForRole('user');
    const result = await resolveProviderForUser(db, 'user-1', prov.id);
    expect(result).toBe(prov);
  });

  it('builtin public → allowed for admin user', async () => {
    const prov = makeProvider({ ownerUserId: null, visibility: 'public' });
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });
    const db = makeFakeDbForRole('admin');
    const result = await resolveProviderForUser(db, 'admin-1', prov.id);
    expect(result).toBe(prov);
  });

  it('builtin private → null for non-admin user', async () => {
    const prov = makeProvider({ ownerUserId: null, visibility: 'private' });
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });
    const db = makeFakeDbForRole('user');
    const result = await resolveProviderForUser(db, 'user-1', prov.id);
    expect(result).toBeNull();
  });

  it('builtin private → allowed for admin user', async () => {
    const prov = makeProvider({ ownerUserId: null, visibility: 'private' });
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });
    const db = makeFakeDbForRole('admin');
    const result = await resolveProviderForUser(db, 'admin-1', prov.id);
    expect(result).toBe(prov);
  });

  it('personal owned by same user → allowed', async () => {
    const prov = makeProvider({ ownerUserId: 'alice', visibility: null });
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });
    const db = makeFakeDbForRole('user');
    const result = await resolveProviderForUser(db, 'alice', prov.id);
    expect(result).toBe(prov);
  });

  it('personal owned by another user → null', async () => {
    const prov = makeProvider({ ownerUserId: 'bob', visibility: null });
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });
    const db = makeFakeDbForRole('user');
    const result = await resolveProviderForUser(db, 'alice', prov.id);
    expect(result).toBeNull();
  });
});

// ─────────────────────────── listAvailableForUser ───────────────────────────

describe('listAvailableForUser', () => {
  it('non-admin: only public built-ins + own personal', async () => {
    const publicBuiltin = makeProvider({ id: 'b-pub', ownerUserId: null, visibility: 'public' });
    const ownPersonal = makeProvider({
      id: 'p-mine',
      ownerUserId: 'alice',
      visibility: null,
      type: 'oauth',
    });

    const db = makeFakeDbForRole('user');

    mockListBuiltinRows.mockImplementationOnce(async (_db: DB, opts?: { publicOnly?: boolean }) => {
      expect(opts?.publicOnly).toBe(true);
      return [{ provider: publicBuiltin, models: [] }];
    });
    mockListOwnerRows.mockResolvedValueOnce([{ provider: ownPersonal, models: [] }]);

    const result = await listAvailableForUser(db, 'alice');
    expect(result.builtin).toHaveLength(1);
    expect(result.personal).toHaveLength(1);
    expect(result.builtin[0]?.id).toBe('b-pub');
    expect(result.personal[0]?.id).toBe('p-mine');
  });

  it('admin: all built-ins (no publicOnly filter)', async () => {
    const publicBuiltin = makeProvider({ id: 'b-pub', ownerUserId: null, visibility: 'public' });
    const privateBuiltin = makeProvider({ id: 'b-priv', ownerUserId: null, visibility: 'private' });

    const db = makeFakeDbForRole('admin');

    mockListBuiltinRows.mockImplementationOnce(async (_db: DB, opts?: { publicOnly?: boolean }) => {
      // admin path: publicOnly should NOT be set to true
      expect(opts?.publicOnly).not.toBe(true);
      return [
        { provider: publicBuiltin, models: [] },
        { provider: privateBuiltin, models: [] },
      ];
    });
    mockListOwnerRows.mockResolvedValueOnce([]);

    const result = await listAvailableForUser(db, 'admin-1');
    expect(result.builtin).toHaveLength(2);
    expect(result.personal).toHaveLength(0);
  });

  it('toDTO is applied — tokenMasked is masked, not raw', async () => {
    const prov = makeProvider({
      id: 'b-1',
      ownerUserId: null,
      visibility: 'public',
      token: 'super-secret-xyz9',
    });
    const model = makeModel({ providerId: 'b-1' });

    const db = makeFakeDbForRole('user');
    mockListBuiltinRows.mockResolvedValueOnce([{ provider: prov, models: [model] }]);
    mockListOwnerRows.mockResolvedValueOnce([]);

    const result = await listAvailableForUser(db, 'user-1');
    expect(result.builtin[0]?.tokenMasked).toBe('***xyz9');
  });
});

// ─────────────────────────── defaultSelectionForUser ───────────────────────────

describe('defaultSelectionForUser', () => {
  // oauth providers persist OAUTH_MODELS into provider_models on create, so
  // listOwnerRows returns them with a non-empty models array — mirror that here.
  function oauthModelsFor(providerId: string): ProviderModelRow[] {
    return OAUTH_MODELS.map((m, i) =>
      makeModel({
        id: `${providerId}-m${i}`,
        providerId,
        modelId: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        isDefault: m.id === OAUTH_DEFAULT_MODEL,
      }),
    );
  }

  it('(1) most-recent session resolves → returns { providerId, model }', async () => {
    const prov = makeProvider({ id: 'prov-sess', ownerUserId: 'alice', visibility: null });

    // DB returns a session row, then getProviderRow resolves
    mockGetProviderRow.mockResolvedValueOnce({ provider: prov, models: [] });

    // Build db: session query returns a row
    const db = makeFakeDbWithSession('user', {
      providerId: 'prov-sess',
      model: 'claude-sonnet-4-6',
    });

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'prov-sess', model: 'claude-sonnet-4-6' });
  });

  it('(2) no session + personal api-key provider → picks its default model', async () => {
    const apiProv = makeProvider({
      id: 'api-1',
      ownerUserId: 'alice',
      type: 'api',
      visibility: null,
    });
    const models = [
      makeModel({ id: 'a-m1', providerId: 'api-1', modelId: 'kimi-k2', isDefault: false }),
      makeModel({ id: 'a-m2', providerId: 'api-1', modelId: 'kimi-k2-default', isDefault: true }),
    ];

    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([{ provider: apiProv, models }]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'api-1', model: 'kimi-k2-default' });
  });

  it('(2) personal api-key provider with no isDefault → picks first model', async () => {
    const apiProv = makeProvider({
      id: 'api-nodefault',
      ownerUserId: 'alice',
      type: 'api',
      visibility: null,
    });
    const models = [
      makeModel({ id: 'n-m1', providerId: 'api-nodefault', modelId: 'first', isDefault: false }),
      makeModel({ id: 'n-m2', providerId: 'api-nodefault', modelId: 'second', isDefault: false }),
    ];

    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([{ provider: apiProv, models }]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'api-nodefault', model: 'first' });
  });

  it('(2) personal oauth provider (persisted models) → picks OAUTH_DEFAULT_MODEL', async () => {
    const oauthProv = makeProvider({
      id: 'oauth-1',
      ownerUserId: 'alice',
      type: 'oauth',
      visibility: null,
    });

    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([
      { provider: oauthProv, models: oauthModelsFor('oauth-1') },
    ]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'oauth-1', model: OAUTH_DEFAULT_MODEL });
  });

  it('(2) personal provider with zero models is skipped → next provider chosen', async () => {
    const emptyProv = makeProvider({
      id: 'empty',
      ownerUserId: 'alice',
      type: 'api',
      visibility: null,
    });
    const goodProv = makeProvider({
      id: 'good',
      ownerUserId: 'alice',
      type: 'api',
      visibility: null,
    });
    const goodModels = [makeModel({ id: 'g-m1', providerId: 'good', modelId: 'use-me' })];

    const db = makeFakeDbWithSession('user', null);
    // newest-first order: empty provider comes first but must be skipped.
    mockListOwnerRows.mockResolvedValueOnce([
      { provider: emptyProv, models: [] },
      { provider: goodProv, models: goodModels },
    ]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'good', model: 'use-me' });
  });

  it('(2) personal provider with zero models and no other personal → falls through, no model-less selection', async () => {
    const emptyProv = makeProvider({
      id: 'empty-only',
      ownerUserId: 'alice',
      type: 'api',
      visibility: null,
    });

    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([{ provider: emptyProv, models: [] }]);
    // No public built-ins either.
    mockListBuiltinRows.mockResolvedValueOnce([]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toBeNull();
  });

  it('(3) no personal + public built-in with models → picks built-in default', async () => {
    const builtinPub = makeProvider({
      id: 'b-pub',
      ownerUserId: null,
      visibility: 'public',
      type: 'api',
    });
    const models = [
      makeModel({ id: 'b-m1', providerId: 'b-pub', modelId: 'bi-a', isDefault: false }),
      makeModel({ id: 'b-m2', providerId: 'b-pub', modelId: 'bi-default', isDefault: true }),
    ];

    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([]);
    mockListBuiltinRows.mockImplementationOnce(async (_db: DB, opts?: { publicOnly?: boolean }) => {
      expect(opts?.publicOnly).toBe(true);
      return [{ provider: builtinPub, models }];
    });

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'b-pub', model: 'bi-default' });
  });

  it('(3) built-in lookup uses publicOnly → private built-in (non-admin) yields null', async () => {
    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([]);
    // publicOnly filter means a private built-in is never returned to a non-admin.
    mockListBuiltinRows.mockImplementationOnce(async (_db: DB, opts?: { publicOnly?: boolean }) => {
      expect(opts?.publicOnly).toBe(true);
      return [];
    });

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toBeNull();
  });

  it('(4) no session, no personal, no public built-in → null', async () => {
    const db = makeFakeDbWithSession('user', null);
    mockListOwnerRows.mockResolvedValueOnce([]);
    mockListBuiltinRows.mockResolvedValueOnce([]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toBeNull();
  });

  it('orphan session (provider no longer resolves) falls through to personal fallback', async () => {
    // Session exists but provider is gone
    mockGetProviderRow.mockResolvedValueOnce(null);

    const oauthProv = makeProvider({
      id: 'oauth-fallback',
      ownerUserId: 'alice',
      type: 'oauth',
      visibility: null,
    });

    // DB returns a session row (orphaned provider)
    const db = makeFakeDbWithSession('user', { providerId: 'dead-provider', model: 'some-model' });

    mockListOwnerRows.mockResolvedValueOnce([
      { provider: oauthProv, models: oauthModelsFor('oauth-fallback') },
    ]);

    const result = await defaultSelectionForUser(db, 'alice');
    expect(result).toEqual({ providerId: 'oauth-fallback', model: OAUTH_DEFAULT_MODEL });
  });
});
