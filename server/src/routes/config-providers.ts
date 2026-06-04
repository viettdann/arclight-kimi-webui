import { Hono } from 'hono';
import type { ProvidersListResponse } from 'shared/types/providers';
import { type AuthVariables, requireAdmin, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { listAvailableForUser } from '../services/providers/resolve';
import {
  getBuiltin,
  getOwned,
  listBuiltinRows,
  listOwnerRows,
  toDTO,
} from '../services/providers/store';
import {
  handleCreate,
  handleDelete,
  handleFetchModels,
  handleTest,
  handleUpdate,
  type ProviderScopeConfig,
} from './provider-route-helpers';

export interface ConfigProvidersRouterDeps {
  db: DB;
}

export function createConfigProvidersRouter(
  deps: ConfigProvidersRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();

  // ─────────────────────────── GET / ───────────────────────────
  // Auth'd user: list personal providers.

  router.get('/', requireAuth, async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const rows = await listOwnerRows(db, user.id);
    return c.json({ providers: rows.map((r) => toDTO(r.provider, r.models)) });
  });

  // ─────────────────────────── POST / ───────────────────────────
  // Auth'd user: create personal provider.

  router.post('/', requireAuth, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleCreate(c, db, personalScope(user.id));
  });

  // ─────────────────────────── GET /builtin ───────────────────────────
  // Admin: list built-in providers.

  router.get('/builtin', requireAdmin, async (c) => {
    const rows = await listBuiltinRows(db, {});
    const body: ProvidersListResponse = {
      providers: rows.map((r) => toDTO(r.provider, r.models)),
    };
    return c.json(body);
  });

  // ─────────────────────────── POST /builtin ───────────────────────────
  // Admin: create built-in provider.

  router.post('/builtin', requireAdmin, (c) => handleCreate(c, db, builtinScope));

  // ─────────────────────────── PATCH /builtin/:id ───────────────────────────
  // Admin: update built-in provider.

  router.patch('/builtin/:id', requireAdmin, (c) => handleUpdate(c, db, builtinScope));

  // ─────────────────────────── DELETE /builtin/:id ───────────────────────────
  // Admin: delete built-in provider.

  router.delete('/builtin/:id', requireAdmin, (c) => handleDelete(c, db, builtinScope));

  // ─────────────────────────── POST /builtin/test ───────────────────────────
  // Admin: test built-in provider.

  router.post('/builtin/test', requireAdmin, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleTest(c, db, user.id, builtinScope);
  });

  // ─────────────────────────── POST /builtin/models ───────────────────────────
  // Admin: fetch built-in provider models.

  router.post('/builtin/models', requireAdmin, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleFetchModels(c, db, user.id, builtinScope);
  });

  // ─────────────────────────── PATCH /:id ───────────────────────────
  // Auth'd user: update personal provider (ownership via scope).

  router.patch('/:id', requireAuth, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleUpdate(c, db, personalScope(user.id));
  });

  // ─────────────────────────── DELETE /:id ───────────────────────────
  // Auth'd user: delete personal provider (ownership via scope).

  router.delete('/:id', requireAuth, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleDelete(c, db, personalScope(user.id));
  });

  // ─────────────────────────── POST /test ───────────────────────────
  // Auth'd user: test personal provider.

  router.post('/test', requireAuth, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleTest(c, db, user.id, personalScope(user.id));
  });

  // ─────────────────────────── POST /models ───────────────────────────
  // Auth'd user: fetch personal provider models.

  router.post('/models', requireAuth, (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleFetchModels(c, db, user.id, personalScope(user.id));
  });

  // ─────────────────────────── GET /available ───────────────────────────
  // Auth'd user: provider catalog for chat composer.

  router.get('/available', requireAuth, async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return c.json(await listAvailableForUser(db, user.id));
  });

  return router;
}

// ─── Scope configs ─────────────────────────────────────────────────────────

const builtinScope: ProviderScopeConfig = {
  ownerUserId: null,
  fetchExisting: getBuiltin,
  forceType: 'api',
  allowVisibility: true,
};

function personalScope(userId: string): ProviderScopeConfig {
  return {
    ownerUserId: userId,
    fetchExisting: (d, id) => getOwned(d, userId, id),
    allowOAuth: true,
  };
}

export default createConfigProvidersRouter({ db: defaultDb });
