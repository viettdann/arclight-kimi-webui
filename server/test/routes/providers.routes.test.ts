import { describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ProviderTestResponse } from 'shared/types/providers';
import type { AuthVariables } from '../../src/auth/middleware';
import type { DB } from '../../src/db';
import type { ProviderModelRow, ProviderRow } from '../../src/db/schema';
import { createMeProvidersRouter } from '../../src/routes/me-providers';
import { createProvidersRouter } from '../../src/routes/providers';
import { makeFakeDb } from '../_helpers';

// ─────────────────────────── Store mock ───────────────────────────
//
// We mock the store to avoid any DB transaction wiring and focus on guard logic.

const mockGetBuiltin = mock(
  async (_db: DB, _id: string) =>
    null as { provider: ProviderRow; models: ProviderModelRow[] } | null,
);
const mockGetOwned = mock(
  async (_db: DB, _userId: string, _id: string) =>
    null as { provider: ProviderRow; models: ProviderModelRow[] } | null,
);
const mockListBuiltinRows = mock(
  async (_db: DB, _opts?: { publicOnly?: boolean }) =>
    [] as { provider: ProviderRow; models: ProviderModelRow[] }[],
);
const mockListOwnerRows = mock(
  async (_db: DB, _userId: string) => [] as { provider: ProviderRow; models: ProviderModelRow[] }[],
);
const mockCreateProvider = mock(async () => ({ provider: makeProvider(), models: [] }));
const mockUpdateProvider = mock(async () => ({ provider: makeProvider(), models: [] }));
const mockRemoveProvider = mock(async () => true);
const mockToDTO = mock((p: ProviderRow, ms: ProviderModelRow[]) => ({
  id: p.id,
  scope: p.ownerUserId === null ? 'builtin' : 'personal',
  type: p.type,
  visibility: p.visibility,
  namespace: p.namespace,
  baseUrl: p.baseUrl ?? null,
  tokenMasked: `***${p.token.slice(-4)}`,
  models: ms.map((m) => ({
    id: m.id,
    modelId: m.modelId,
    displayName: m.displayName ?? null,
    contextWindow: m.contextWindow ?? null,
    isDefault: m.isDefault,
  })),
  createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
  updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
}));

mock.module('../../src/services/providers/store', () => ({
  getBuiltin: mockGetBuiltin,
  getOwned: mockGetOwned,
  listBuiltinRows: mockListBuiltinRows,
  listOwnerRows: mockListOwnerRows,
  createProvider: mockCreateProvider,
  updateProvider: mockUpdateProvider,
  removeProvider: mockRemoveProvider,
  toDTO: mockToDTO,
}));

// Also mock testProvider so POST / and POST /test don't actually hit the network
const mockTestProvider = mock(
  async (): Promise<ProviderTestResponse> => ({ ok: true, availableModels: [] }),
);
mock.module('../../src/services/providers/test', () => ({
  testProvider: mockTestProvider,
}));

// ─────────────────────────── Test helpers ───────────────────────────

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

type MockUser = { id: string; email: string; role: 'admin' | 'user' };

function buildAdminApp(_role: 'admin' | 'user', user: MockUser) {
  const fake = makeFakeDb();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(
    '*',
    createMiddleware(async (c, next) => {
      c.set('user', user as unknown as never);
      c.set('authSession', null);
      await next();
    }),
  );
  app.route('/api/admin/providers', createProvidersRouter({ db: fake.db }));
  return { app, fake };
}

function buildMeApp(user: MockUser) {
  const fake = makeFakeDb();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(
    '*',
    createMiddleware(async (c, next) => {
      c.set('user', user as unknown as never);
      c.set('authSession', null);
      await next();
    }),
  );
  app.route('/api/me-providers', createMeProvidersRouter({ db: fake.db }));
  return { app, fake };
}

const ADMIN_USER: MockUser = { id: 'admin-1', email: 'admin@x.com', role: 'admin' };
const REGULAR_USER: MockUser = { id: 'user-1', email: 'user@x.com', role: 'user' };

// ─────────────────────────── Built-in admin router guard tests ───────────────────────────

describe('createProvidersRouter — requireAdmin guard', () => {
  it('non-admin GET / → 403', async () => {
    const { app } = buildAdminApp('user', REGULAR_USER);
    const res = await app.request('/api/admin/providers', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('non-admin POST / → 403', async () => {
    const { app } = buildAdminApp('user', REGULAR_USER);
    const res = await app.request('/api/admin/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'ns', token: 'tok' }),
    });
    expect(res.status).toBe(403);
  });

  it('non-admin PATCH /:id → 403', async () => {
    const { app } = buildAdminApp('user', REGULAR_USER);
    const res = await app.request('/api/admin/providers/some-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'updated' }),
    });
    expect(res.status).toBe(403);
  });

  it('non-admin DELETE /:id → 403', async () => {
    const { app } = buildAdminApp('user', REGULAR_USER);
    const res = await app.request('/api/admin/providers/some-id', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('non-admin POST /test → 403', async () => {
    const { app } = buildAdminApp('user', REGULAR_USER);
    const res = await app.request('/api/admin/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'api', token: 'tok' }),
    });
    expect(res.status).toBe(403);
  });

  it('admin GET / → 200 (guard passes)', async () => {
    mockListBuiltinRows.mockResolvedValueOnce([]);
    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: unknown[] };
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it('admin DELETE /:id → 200 when provider exists', async () => {
    const prov = makeProvider({ id: 'del-id', ownerUserId: null });
    mockGetBuiltin.mockResolvedValueOnce({ provider: prov, models: [] });
    mockRemoveProvider.mockResolvedValueOnce(true);

    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers/del-id', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('admin DELETE /:id → 404 when provider not found', async () => {
    mockGetBuiltin.mockResolvedValueOnce(null);

    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('unauthenticated (user=null) → 401', async () => {
    const fake = makeFakeDb();
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use(
      '*',
      createMiddleware(async (c, next) => {
        c.set('user', null);
        c.set('authSession', null);
        await next();
      }),
    );
    app.route('/api/admin/providers', createProvidersRouter({ db: fake.db }));
    const res = await app.request('/api/admin/providers', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────── Me-providers router guard/ownership tests ───────────────────────────

describe('createMeProvidersRouter — requireAuth guard', () => {
  it('unauthenticated → 401', async () => {
    const fake = makeFakeDb();
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use(
      '*',
      createMiddleware(async (c, next) => {
        c.set('user', null);
        c.set('authSession', null);
        await next();
      }),
    );
    app.route('/api/me-providers', createMeProvidersRouter({ db: fake.db }));
    const res = await app.request('/api/me-providers', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('authenticated user GET / → 200', async () => {
    mockListOwnerRows.mockResolvedValueOnce([]);
    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: unknown[] };
    expect(Array.isArray(body.providers)).toBe(true);
  });
});

describe('createMeProvidersRouter — ownership enforcement', () => {
  it("PATCH on another user's provider id → 404 (getOwned scoped to c.var.user.id)", async () => {
    // user-1 tries to PATCH a provider owned by user-2
    // getOwned filters: where(id = X AND ownerUserId = user-1) → empty → 404
    mockGetOwned.mockImplementationOnce(async (_db, userId, _id) => {
      // Only returns the row if it belongs to user-1; for this test it doesn't
      if (userId !== 'user-2') return null;
      return { provider: makeProvider({ id: 'other-prov', ownerUserId: 'user-2' }), models: [] };
    });

    const { app } = buildMeApp(REGULAR_USER); // user-1
    const res = await app.request('/api/me-providers/other-prov', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'hacked' }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE on another user's provider id → 404", async () => {
    // user-1 tries to DELETE a provider owned by user-2
    mockGetOwned.mockImplementationOnce(async (_db, userId, _id) => {
      if (userId !== 'user-2') return null;
      return { provider: makeProvider({ id: 'other-prov', ownerUserId: 'user-2' }), models: [] };
    });

    const { app } = buildMeApp(REGULAR_USER); // user-1
    const res = await app.request('/api/me-providers/other-prov', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('PATCH on own provider → allowed (200)', async () => {
    const ownProv = makeProvider({ id: 'my-prov', ownerUserId: 'user-1', type: 'api' });
    // getOwned returns the row because userId matches
    mockGetOwned.mockResolvedValueOnce({ provider: ownProv, models: [] });
    // No credential change in body → no re-test; updateProvider returns row
    mockUpdateProvider.mockResolvedValueOnce({ provider: ownProv, models: [] });

    const { app } = buildMeApp(REGULAR_USER); // user-1
    const res = await app.request('/api/me-providers/my-prov', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'new-name' }),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE on own provider → 200', async () => {
    const ownProv = makeProvider({ id: 'my-prov', ownerUserId: 'user-1', type: 'oauth' });
    mockGetOwned.mockResolvedValueOnce({ provider: ownProv, models: [] });
    mockRemoveProvider.mockResolvedValueOnce(true);

    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers/my-prov', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('PATCH on a builtin id → 404 (getOwned filters by ownerUserId = user, not null)', async () => {
    // getOwned only matches rows where ownerUserId = user.id
    // A builtin row has ownerUserId = null, so getOwned returns null
    mockGetOwned.mockResolvedValueOnce(null);

    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers/builtin-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'hijack' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE on a builtin id → 404', async () => {
    mockGetOwned.mockResolvedValueOnce(null);

    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers/builtin-id', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────── Input validation tests ───────────────────────────

describe('createProvidersRouter — admin input validation', () => {
  it('POST / missing namespace → 400', async () => {
    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok' }), // missing namespace
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_namespace');
  });

  it('POST / missing token → 400', async () => {
    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'ns' }), // missing token
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_token');
  });
});

describe('createMeProvidersRouter — user input validation', () => {
  it('POST / missing type → 400 invalid_type', async () => {
    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'ns', token: 'tok' }), // missing type
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_type');
  });

  it('POST / invalid type → 400 invalid_type', async () => {
    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'bad-type', namespace: 'ns', token: 'tok' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_type');
  });

  it('POST / valid oauth + test passes → 201', async () => {
    mockTestProvider.mockResolvedValueOnce({ ok: true, availableModels: [] });
    mockCreateProvider.mockResolvedValueOnce({
      provider: makeProvider({
        id: 'new-oauth',
        ownerUserId: 'user-1',
        type: 'oauth',
        visibility: null,
      }),
      models: [],
    });

    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'oauth', namespace: 'My Claude', token: 'oauth-tok' }),
    });
    expect(res.status).toBe(201);
  });

  it('POST / test fails → 400 test_failed', async () => {
    mockTestProvider.mockResolvedValueOnce({ ok: false, error: 'auth_error' });

    const { app } = buildMeApp(REGULAR_USER);
    const res = await app.request('/api/me-providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'oauth', namespace: 'ns', token: 'bad-tok' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toBe('test_failed');
  });
});

// ─────────────────────────── Built-in create/update behavior (T3) ───────────────────────────

describe('createProvidersRouter — built-in create/update', () => {
  it('POST / defaults visibility to "private" and returns 201', async () => {
    mockTestProvider.mockResolvedValueOnce({ ok: true, availableModels: [] });
    mockCreateProvider.mockResolvedValueOnce({
      provider: makeProvider({ id: 'b-new', ownerUserId: null, visibility: 'private' }),
      models: [],
    });

    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'NS', token: 'tok' }), // no visibility supplied
    });
    expect(res.status).toBe(201);

    // The store create call must carry the private default and a null owner (built-in).
    const args = mockCreateProvider.mock.calls.at(-1) as unknown as unknown[];
    const input = args[1] as { ownerUserId: string | null; type: string; visibility: unknown };
    expect(input.visibility).toBe('private');
    expect(input.ownerUserId).toBeNull();
    expect(input.type).toBe('api');
  });

  it('POST / honors an explicit visibility="public"', async () => {
    mockTestProvider.mockResolvedValueOnce({ ok: true, availableModels: [] });
    mockCreateProvider.mockResolvedValueOnce({
      provider: makeProvider({ id: 'b-pub', ownerUserId: null, visibility: 'public' }),
      models: [],
    });

    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'NS', token: 'tok', visibility: 'public' }),
    });
    expect(res.status).toBe(201);
    const createArgs = mockCreateProvider.mock.calls.at(-1) as unknown as unknown[];
    const input = createArgs[1] as { visibility: unknown };
    expect(input.visibility).toBe('public');
  });

  it('PATCH /:id on an existing built-in → 200', async () => {
    const prov = makeProvider({ id: 'b-edit', ownerUserId: null, visibility: 'private' });
    mockGetBuiltin.mockResolvedValueOnce({ provider: prov, models: [] });
    mockUpdateProvider.mockResolvedValueOnce({
      provider: makeProvider({ id: 'b-edit', ownerUserId: null, namespace: 'Renamed' }),
      models: [],
    });

    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers/b-edit', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'Renamed', visibility: 'public' }), // no credential change → no re-test
    });
    expect(res.status).toBe(200);

    // updateProvider must receive the built-in mutation scope.
    const updateArgs = mockUpdateProvider.mock.calls.at(-1) as unknown as unknown[];
    expect(updateArgs[3]).toEqual({ builtin: true });
  });
});

// ─────────────────────────── H2 base-URL guard (T3) ───────────────────────────

describe('provider base-URL SSRF guard (H2)', () => {
  it('admin POST / with a private-IP baseUrl → 400 invalid_base_url', async () => {
    const { app } = buildAdminApp('admin', ADMIN_USER);
    const res = await app.request('/api/admin/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'NS', token: 'tok', baseUrl: 'http://127.0.0.1:8080' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_base_url');
  });

  it('admin POST /test with a private-IP baseUrl → invalid_base_url', async () => {
    // Distinct user id so the per-user /test cooldown never crosses test cases.
    const admin: MockUser = { id: 'admin-guard-1', email: 'a@x.com', role: 'admin' };
    const { app } = buildAdminApp('admin', admin);
    const res = await app.request('/api/admin/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'api', token: 'tok', baseUrl: 'http://10.0.0.5' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_base_url');
  });

  it('admin POST /test reuses the SAVED base URL, ignoring a posted baseUrl', async () => {
    // Saved built-in row carries a (validated-at-save) base URL.
    const saved = makeProvider({
      id: 'saved-1',
      ownerUserId: null,
      baseUrl: 'https://saved.example.com',
      token: 'saved-token',
    });
    mockGetBuiltin.mockResolvedValueOnce({ provider: saved, models: [] });
    mockTestProvider.mockResolvedValueOnce({ ok: true, availableModels: [] });

    const admin: MockUser = { id: 'admin-reuse-1', email: 'a@x.com', role: 'admin' };
    const { app } = buildAdminApp('admin', admin);
    const res = await app.request('/api/admin/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // token omitted → saved row is loaded; posted baseUrl must be ignored.
      body: JSON.stringify({
        type: 'api',
        providerId: 'saved-1',
        baseUrl: 'https://attacker.example.com',
      }),
    });
    expect(res.status).toBe(200);

    const testArgs = mockTestProvider.mock.calls.at(-1) as unknown as unknown[];
    const arg = testArgs[0] as { baseUrl: string | null; token: string };
    expect(arg.baseUrl).toBe('https://saved.example.com');
    expect(arg.token).toBe('saved-token');
  });
});
