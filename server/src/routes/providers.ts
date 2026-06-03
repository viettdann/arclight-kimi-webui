import { Hono } from 'hono';
import type { ProvidersListResponse } from 'shared/types/providers';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { getBuiltin, listBuiltinRows, toDTO } from '../services/providers/store';
import {
  handleCreate,
  handleDelete,
  handleFetchModels,
  handleTest,
  handleUpdate,
  type ProviderScopeConfig,
} from './provider-route-helpers';

export interface ProvidersRouterDeps {
  db: DB;
}

export function createProvidersRouter(
  deps: ProvidersRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  // Built-in scope: admin-managed, API-only, carries a visibility flag.
  const scope: ProviderScopeConfig = {
    ownerUserId: null,
    fetchExisting: getBuiltin,
    forceType: 'api',
    allowVisibility: true,
  };

  // ─────────────────────────── GET / ───────────────────────────

  router.get('/', async (c) => {
    const rows = await listBuiltinRows(db, {});
    const body: ProvidersListResponse = {
      providers: rows.map((r) => toDTO(r.provider, r.models)),
    };
    return c.json(body);
  });

  // ─────────────────────────── POST / ───────────────────────────

  router.post('/', (c) => handleCreate(c, db, scope));

  // ─────────────────────────── PATCH /:id ───────────────────────────

  router.patch('/:id', (c) => handleUpdate(c, db, scope));

  // ─────────────────────────── DELETE /:id ───────────────────────────

  router.delete('/:id', (c) => handleDelete(c, db, scope));

  // ─────────────────────────── POST /test ───────────────────────────

  router.post('/test', (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleTest(c, db, user.id, scope);
  });

  // ─────────────────────────── POST /models ───────────────────────────

  router.post('/models', (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleFetchModels(c, db, user.id, scope);
  });

  return router;
}

export default createProvidersRouter({ db: defaultDb });
