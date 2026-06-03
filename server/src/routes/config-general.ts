import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  GitCredentialListResponse,
  GitCredentialTestRequest,
  GitCredentialTestResponse,
  GitProvider,
} from 'shared/types';
import { isGitProvider } from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import type { DB } from '../db';
import { type Env, env as defaultEnv } from '../env';
import { testRemote } from '../services/git/clone';
import { toDTO as toGitCredDTO } from '../services/git-credentials/mask';
import * as gitCredRepo from '../services/git-credentials/repo';

/** Max byte length for user preferences (global CLAUDE.md). */
const USER_PREFERENCES_MAX_BYTES = 32_768;

export interface ConfigGeneralRouterDeps {
  db: DB;
  env?: Pick<Env, 'GIT_CLONE_TIMEOUT_MS' | 'WORKSPACE_ROOT'>;
  testRemote?: typeof testRemote;
}

/**
 * Path to a user's own global memory file:
 * `${WORKSPACE_ROOT}/<userSlug>/.claude/CLAUDE.md`.
 */
function userMemoryPath(userSlug: string, workspaceRoot: string): string {
  return path.join(workspaceRoot, userSlug, '.claude', 'CLAUDE.md');
}

export function createConfigGeneralRouter(
  deps: ConfigGeneralRouterDeps,
): Hono<{ Variables: AuthVariables }> {
  const db = deps.db;
  const env = deps.env ?? defaultEnv;
  const testRemoteFn = deps.testRemote ?? testRemote;

  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // ─────────────────────────── GET /preferences ───────────────────────────
  // Read user's global CLAUDE.md (personal instructions).

  router.get('/preferences', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const file = userMemoryPath(slug(user.email), env.WORKSPACE_ROOT);
    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return c.json({ content });
  });

  // ─────────────────────────── PUT /preferences ───────────────────────────
  // Write user's global CLAUDE.md.

  router.put('/preferences', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    let payload: { content?: unknown };
    try {
      payload = (await c.req.json()) as { content?: unknown };
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (typeof payload?.content !== 'string') {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const bytes = Buffer.byteLength(payload.content, 'utf8');
    if (bytes > USER_PREFERENCES_MAX_BYTES) {
      return c.json({ error: 'too_large', max: USER_PREFERENCES_MAX_BYTES, got: bytes }, 400);
    }

    const file = userMemoryPath(slug(user.email), env.WORKSPACE_ROOT);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, payload.content, { mode: 0o600 });

    return c.json({ content: payload.content });
  });

  // ─────────────────────────── GET /git-credentials ───────────────────────────

  router.get('/git-credentials', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const rows = await gitCredRepo.listForUser(db, user.id);
    const body: GitCredentialListResponse = { credentials: rows.map(toGitCredDTO) };
    return c.json(body);
  });

  // ─────────────────────────── POST /git-credentials ───────────────────────────

  router.post('/git-credentials', async (c) => {
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
    if (typeof b.label !== 'string' || b.label.length === 0) {
      return c.json({ error: 'invalid_label' }, 400);
    }
    if (!isGitProvider(b.provider)) {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    if (typeof b.token !== 'string' || b.token.length === 0) {
      return c.json({ error: 'invalid_token' }, 400);
    }

    const row = await gitCredRepo.create(db, user.id, {
      label: b.label,
      provider: b.provider,
      token: b.token,
    });
    return c.json(toGitCredDTO(row), 201);
  });

  // ─────────────────────────── PATCH /git-credentials/:id ───────────────────────────

  router.patch('/git-credentials/:id', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

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

    const updated = await gitCredRepo.update(db, user.id, id, patch);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(toGitCredDTO(updated));
  });

  // ─────────────────────────── DELETE /git-credentials/:id ───────────────────────────

  router.delete('/git-credentials/:id', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    const ok = await gitCredRepo.remove(db, user.id, id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  // ─────────────────────────── POST /git-credentials/test ───────────────────────────

  router.post('/git-credentials/test', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

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
      const row = await gitCredRepo.getOwned(db, user.id, body.credentialId);
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
