import { Hono } from 'hono';
import {
  isProviderType,
  OAUTH_DEFAULT_MODEL,
  OAUTH_MODELS,
  type ProviderCreateRequest,
  type ProviderTestRequest,
} from 'shared/types/providers';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import {
  createProvider,
  getOwned,
  listOwnerRows,
  removeProvider,
  toDTO,
  updateProvider,
} from '../services/providers/store';
import { testProvider } from '../services/providers/test';

export interface MeProvidersRouterDeps {
  db: DB;
}

export function createMeProvidersRouter(
  deps: MeProvidersRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // ─────────────────────────── GET / ───────────────────────────

  router.get('/', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const rows = await listOwnerRows(db, user.id);
    return c.json({ providers: rows.map((r) => toDTO(r.provider, r.models)) });
  });

  // ─────────────────────────── POST / ───────────────────────────

  router.post('/', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

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
    const req = b as unknown as ProviderCreateRequest;

    if (!isProviderType(req.type)) {
      return c.json({ error: 'invalid_type' }, 400);
    }
    if (typeof b.namespace !== 'string' || (b.namespace as string).length === 0) {
      return c.json({ error: 'invalid_namespace' }, 400);
    }
    if (typeof b.token !== 'string' || (b.token as string).length === 0) {
      return c.json({ error: 'invalid_token' }, 400);
    }

    const namespace = req.namespace;
    const token = req.token;

    if (req.type === 'oauth') {
      const result = await testProvider({ type: 'oauth', token });
      if (!result.ok) return c.json({ error: 'test_failed', detail: result.error }, 400);

      const created = await createProvider(db, {
        ownerUserId: user.id,
        type: 'oauth',
        visibility: null,
        namespace,
        baseUrl: null,
        token,
        models: OAUTH_MODELS.map((m) => ({
          modelId: m.id,
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          isDefault: m.id === OAUTH_DEFAULT_MODEL,
        })),
      });
      return c.json(toDTO(created.provider, created.models), 201);
    }

    // api
    const models = Array.isArray(req.models) ? req.models : [];
    const pingModel = models.find((m) => m.isDefault)?.modelId ?? models[0]?.modelId ?? undefined;

    const result = await testProvider({
      type: 'api',
      baseUrl: req.baseUrl ?? null,
      token,
      model: pingModel,
    });
    if (!result.ok) return c.json({ error: 'test_failed', detail: result.error }, 400);

    const created = await createProvider(db, {
      ownerUserId: user.id,
      type: 'api',
      visibility: null,
      namespace,
      baseUrl: req.baseUrl ?? null,
      token,
      models,
    });
    return c.json(toDTO(created.provider, created.models), 201);
  });

  // ─────────────────────────── PATCH /:id ───────────────────────────

  router.patch('/:id', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    const existing = await getOwned(db, user.id, id);
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
    const providerType = existing.provider.type as 'oauth' | 'api';

    const patch: {
      namespace?: string;
      baseUrl?: string | null;
      token?: string;
      models?: typeof existing.models;
    } = {};

    if (b.namespace !== undefined) patch.namespace = b.namespace as string;
    if (providerType !== 'oauth') {
      if (b.baseUrl !== undefined) patch.baseUrl = b.baseUrl as string | null;
      if (Array.isArray(b.models)) patch.models = b.models as typeof existing.models;
    }
    if (typeof b.token === 'string') patch.token = b.token;

    // Re-test on credential change
    if (b.token !== undefined || (providerType !== 'oauth' && b.baseUrl !== undefined)) {
      const token = typeof b.token === 'string' ? b.token : existing.provider.token;
      const baseUrl =
        providerType !== 'oauth'
          ? b.baseUrl !== undefined
            ? (b.baseUrl as string | null)
            : existing.provider.baseUrl
          : null;

      const result = await testProvider({
        type: providerType,
        baseUrl,
        token,
        model:
          providerType !== 'oauth'
            ? ((Array.isArray(b.models) ? b.models : existing.models) as { modelId: string }[])[0]
                ?.modelId
            : undefined,
      });
      if (!result.ok) return c.json({ error: 'test_failed', detail: result.error }, 400);
    }

    const updated = await updateProvider(db, id, patch);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(toDTO(updated.provider, updated.models));
  });

  // ─────────────────────────── DELETE /:id ───────────────────────────

  router.delete('/:id', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    const existing = await getOwned(db, user.id, id);
    if (!existing) return c.json({ error: 'not_found' }, 404);
    await removeProvider(db, id);
    return c.json({ ok: true });
  });

  // ─────────────────────────── POST /test ───────────────────────────

  router.post('/test', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

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

    if (!isProviderType(req.type)) {
      return c.json({ ok: false, error: 'invalid_type' });
    }

    let token: string | null = typeof req.token === 'string' ? req.token : null;
    let baseUrl: string | null = req.baseUrl ?? null;

    if ((!token || token.length === 0) && req.providerId) {
      const saved = await getOwned(db, user.id, req.providerId);
      if (saved) {
        token = saved.provider.token;
        if (baseUrl === null) baseUrl = saved.provider.baseUrl;
      }
    }

    if (!token) {
      return c.json({ ok: false, error: 'missing_token' });
    }

    const result = await testProvider({
      type: req.type,
      baseUrl,
      token,
      model: req.model ?? undefined,
    });
    return c.json(result);
  });

  return router;
}

export default createMeProvidersRouter({ db: defaultDb });
