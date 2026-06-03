import { Hono } from 'hono';
import type {
  GitCredentialListResponse,
  GitCredentialTestRequest,
  GitCredentialTestResponse,
  GitProvider,
} from 'shared/types/git-credentials';
import { isGitProvider } from 'shared/types/git-credentials';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { testRemote } from '../services/git/clone';
import { toDTO } from '../services/git-credentials/mask';
import * as repo from '../services/git-credentials/repo';

export interface GitCredentialsRouterDeps {
  db?: DB;
  env?: Pick<Env, 'GIT_CLONE_TIMEOUT_MS'>;
  testRemote?: typeof testRemote;
}

export function createGitCredentialsRouter(
  deps: GitCredentialsRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const db = deps.db ?? defaultDb;
  const env = deps.env ?? defaultEnv;
  const testRemoteFn = deps.testRemote ?? testRemote;

  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // ─────────────────────────── GET / ───────────────────────────

  router.get('/', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const rows = await repo.listForUser(db, user.id);
    const body: GitCredentialListResponse = { credentials: rows.map(toDTO) };
    return c.json(body);
  });

  // ─────────────────────────── POST / ───────────────────────────

  router.post('/', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

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
    if (typeof b.label !== 'string' || b.label.length === 0) {
      return c.json({ error: 'invalid_label' }, 400);
    }
    if (!isGitProvider(b.provider)) {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    if (typeof b.token !== 'string' || b.token.length === 0) {
      return c.json({ error: 'invalid_token' }, 400);
    }

    const row = await repo.create(db, user.id, {
      label: b.label,
      provider: b.provider,
      token: b.token,
    });
    return c.json(toDTO(row), 201);
  });

  // ─────────────────────────── PATCH /:id ───────────────────────────

  router.patch('/:id', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');

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
    if (b.label !== undefined && (typeof b.label !== 'string' || b.label.length === 0)) {
      return c.json({ error: 'invalid_label' }, 400);
    }
    if (b.provider !== undefined && !isGitProvider(b.provider)) {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    if (b.token !== undefined && typeof b.token !== 'string') {
      return c.json({ error: 'invalid_token' }, 400);
    }

    const patch: { label?: string; provider?: GitProvider; token?: string } = {};
    if (b.label !== undefined) patch.label = b.label as string;
    if (b.provider !== undefined) patch.provider = b.provider as GitProvider;
    if (b.token !== undefined) patch.token = b.token as string;

    const updated = await repo.update(db, user.id, id, patch);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(toDTO(updated));
  });

  // ─────────────────────────── DELETE /:id ───────────────────────────

  router.delete('/:id', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    const ok = await repo.remove(db, user.id, id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  // ─────────────────────────── POST /test ───────────────────────────

  router.post('/test', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    let body: GitCredentialTestRequest;
    try {
      body = (await c.req.json()) as GitCredentialTestRequest;
    } catch {
      return c.json({ ok: false, error: 'invalid_body' } satisfies GitCredentialTestResponse);
    }

    if (typeof body.url !== 'string' || body.url.length === 0) {
      return c.json({ ok: false, error: 'invalid_url' } satisfies GitCredentialTestResponse);
    }

    let provider: GitProvider;
    let token: string;

    if (body.credentialId) {
      const row = await repo.getOwned(db, user.id, body.credentialId);
      if (!row) {
        return c.json({
          ok: false,
          error: 'credential_not_found',
        } satisfies GitCredentialTestResponse);
      }
      if (!isGitProvider(row.provider)) {
        return c.json({ ok: false, error: 'invalid_provider' } satisfies GitCredentialTestResponse);
      }
      provider = row.provider;
      token = row.token;
    } else if (body.inlineToken && body.provider) {
      if (!isGitProvider(body.provider)) {
        return c.json({ ok: false, error: 'invalid_provider' } satisfies GitCredentialTestResponse);
      }
      provider = body.provider;
      token = body.inlineToken;
    } else {
      return c.json({ ok: false, error: 'missing_credential' } satisfies GitCredentialTestResponse);
    }

    const result = await testRemoteFn({
      url: body.url,
      provider,
      token,
      timeoutMs: env.GIT_CLONE_TIMEOUT_MS,
    });
    return c.json(result satisfies GitCredentialTestResponse);
  });

  return router;
}
