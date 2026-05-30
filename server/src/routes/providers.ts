import { Hono } from 'hono';
import {
  isVisibility,
  type ProviderCreateRequest,
  type ProvidersListResponse,
  type ProviderTestRequest,
} from 'shared/types/providers';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import {
  createProvider,
  getBuiltin,
  listBuiltinRows,
  removeProvider,
  toDTO,
  updateProvider,
} from '../services/providers/store';
import { testProvider } from '../services/providers/test';

export interface ProvidersRouterDeps {
  db: DB;
}

export function createProvidersRouter(
  deps: ProvidersRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  // ─────────────────────────── GET / ───────────────────────────

  router.get('/', async (c) => {
    const rows = await listBuiltinRows(db, {});
    const body: ProvidersListResponse = {
      providers: rows.map((r) => toDTO(r.provider, r.models)),
    };
    return c.json(body);
  });

  // ─────────────────────────── POST / ───────────────────────────

  router.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const b = body as Record<string, unknown>;

    if (typeof b.namespace !== 'string' || b.namespace.length === 0) {
      return c.json({ error: 'invalid_namespace' }, 400);
    }
    if (typeof b.token !== 'string' || b.token.length === 0) {
      return c.json({ error: 'invalid_token' }, 400);
    }

    const req = b as unknown as ProviderCreateRequest;
    const models = Array.isArray(req.models) ? req.models : [];
    const pingModel = models.find((m) => m.isDefault)?.modelId ?? models[0]?.modelId ?? undefined;

    const result = await testProvider({
      type: 'api',
      baseUrl: req.baseUrl ?? null,
      token: req.token,
      model: pingModel,
    });
    if (!result.ok) {
      return c.json({ error: 'test_failed', detail: result.error }, 400);
    }

    const created = await createProvider(db, {
      ownerUserId: null,
      type: 'api',
      visibility: isVisibility(req.visibility) ? req.visibility : 'private',
      namespace: req.namespace,
      baseUrl: req.baseUrl ?? null,
      token: req.token,
      models,
    });

    return c.json(toDTO(created.provider, created.models), 201);
  });

  // ─────────────────────────── PATCH /:id ───────────────────────────

  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await getBuiltin(db, id);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const b = body as Record<string, unknown>;
    const patch: {
      namespace?: string;
      baseUrl?: string | null;
      visibility?: 'public' | 'private';
      token?: string;
      models?: typeof existing.models;
    } = {};

    if (b.namespace !== undefined) patch.namespace = b.namespace as string;
    if (b.baseUrl !== undefined) patch.baseUrl = b.baseUrl as string | null;
    if (b.visibility !== undefined && isVisibility(b.visibility)) patch.visibility = b.visibility;
    if (typeof b.token === 'string') patch.token = b.token;
    if (Array.isArray(b.models)) patch.models = b.models as typeof existing.models;

    // Re-test when credentials changed
    if (b.token !== undefined || b.baseUrl !== undefined) {
      const token = typeof b.token === 'string' ? b.token : existing.provider.token;
      const baseUrl =
        b.baseUrl !== undefined ? (b.baseUrl as string | null) : existing.provider.baseUrl;
      const mergedModels = Array.isArray(b.models) ? b.models : existing.models;
      const pingModel = (mergedModels as { modelId: string }[])[0]?.modelId;

      const result = await testProvider({
        type: 'api',
        baseUrl,
        token,
        model: pingModel,
      });
      if (!result.ok) {
        return c.json({ error: 'test_failed', detail: result.error }, 400);
      }
    }

    const updated = await updateProvider(db, id, patch);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(toDTO(updated.provider, updated.models));
  });

  // ─────────────────────────── DELETE /:id ───────────────────────────

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await getBuiltin(db, id);
    if (!existing) return c.json({ error: 'not_found' }, 404);
    await removeProvider(db, id);
    return c.json({ ok: true });
  });

  // ─────────────────────────── POST /test ───────────────────────────

  router.post('/test', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_body' });
    }
    if (body == null || typeof body !== 'object') {
      return c.json({ ok: false, error: 'invalid_body' });
    }

    const b = body as Record<string, unknown>;
    const req = b as unknown as ProviderTestRequest;

    let token: string | null = typeof req.token === 'string' ? req.token : null;
    let baseUrl: string | null = req.baseUrl ?? null;

    // If token omitted/empty and providerId given, load saved row
    if ((!token || token.length === 0) && req.providerId) {
      const saved = await getBuiltin(db, req.providerId);
      if (saved) {
        token = saved.provider.token;
        if (baseUrl === null) baseUrl = saved.provider.baseUrl;
      }
    }

    if (!token) {
      return c.json({ ok: false, error: 'missing_token' });
    }

    const result = await testProvider({
      type: 'api',
      baseUrl,
      token,
      model: req.model ?? undefined,
    });
    return c.json(result);
  });

  return router;
}

export default createProvidersRouter({ db: defaultDb });
