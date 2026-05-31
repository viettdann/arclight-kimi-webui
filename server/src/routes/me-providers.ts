import { Hono } from 'hono';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { getOwned, listOwnerRows, toDTO } from '../services/providers/store';
import {
  handleCreate,
  handleDelete,
  handleTest,
  handleUpdate,
  type ProviderScopeConfig,
} from './provider-route-helpers';

export interface MeProvidersRouterDeps {
  db: DB;
}

export function createMeProvidersRouter(
  deps: MeProvidersRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // Personal scope: per-user, oauth or api, no visibility flag. Each handler
  // builds the scope from the authenticated user so mutators are owner-bound.
  const scopeFor = (userId: string): ProviderScopeConfig => ({
    ownerUserId: userId,
    fetchExisting: (d, id) => getOwned(d, userId, id),
    allowOAuth: true,
  });

  // ─────────────────────────── GET / ───────────────────────────

  router.get('/', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const rows = await listOwnerRows(db, user.id);
    return c.json({ providers: rows.map((r) => toDTO(r.provider, r.models)) });
  });

  // ─────────────────────────── POST / ───────────────────────────

  router.post('/', (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleCreate(c, db, scopeFor(user.id));
  });

  // ─────────────────────────── PATCH /:id ───────────────────────────

  router.patch('/:id', (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleUpdate(c, db, scopeFor(user.id));
  });

  // ─────────────────────────── DELETE /:id ───────────────────────────

  router.delete('/:id', (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleDelete(c, db, scopeFor(user.id));
  });

  // ─────────────────────────── POST /test ───────────────────────────

  router.post('/test', (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return handleTest(c, db, user.id, scopeFor(user.id));
  });

  return router;
}

export default createMeProvidersRouter({ db: defaultDb });
