import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  MeResponse,
  UserPreferencesResponse,
  UserPreferencesUpdateRequest,
} from 'shared/types';
import { USER_PREFERENCES_MAX_BYTES } from 'shared/types';
import { slug } from '../auth';
import { canUserAccess } from '../auth/access';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import type { DB } from '../db';
import { userMemoryPath } from '../services/agent/agent-paths';

export interface MeRouterDeps {
  db: DB;
}

export function createMeRouter(deps: MeRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  router.get('/', async (c) => {
    // requireAuth guarantees a non-null user.
    const user = c.var.user as NonNullable<AuthVariables['user']> & { role?: string };
    const body: MeResponse = {
      role: user.role === 'admin' ? 'admin' : 'user',
      allowed: await canUserAccess(db, user),
    };
    return c.json(body);
  });

  // Per-user global instructions: the contents of `$HOME/.claude/CLAUDE.md`,
  // where `$HOME` is `WORKSPACE_ROOT/<userSlug>` (see agent isolation). The
  // preset `claude_code` loads this file for every session the user runs, so
  // it is their personal, cross-project memory — distinct from a project's
  // own `<cwd>/CLAUDE.md`.
  //
  // The path is derived from the session user's email, never from the request
  // body, so there is no traversal surface. The data-plane allowlist gate on
  // `/api/me/preferences` (see index.ts) keeps pending users out, while the
  // bare `GET /api/me` stays open so they can still learn their status.

  // The memory file is keyed solely off the session user's email; both handlers
  // resolve it the same way, so the derivation lives in one place.
  const memoryFileFor = (c: { var: AuthVariables }): string =>
    userMemoryPath(slug((c.var.user as NonNullable<AuthVariables['user']>).email ?? ''));

  router.get('/preferences', async (c) => {
    const file = memoryFileFor(c);
    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch (err) {
      // Missing file is the normal "not set yet" case → empty content. Anything
      // else (permissions, IO) propagates as a 500 via the default handler.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const body: UserPreferencesResponse = { content };
    return c.json(body);
  });

  router.put('/preferences', async (c) => {
    let payload: UserPreferencesUpdateRequest;
    try {
      payload = (await c.req.json()) as UserPreferencesUpdateRequest;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof payload?.content !== 'string') {
      return c.json({ error: 'invalid_body' }, 400);
    }

    // Cap by byte length (not character count) so multibyte content can't slip
    // past the limit the client advertises.
    const bytes = Buffer.byteLength(payload.content, 'utf8');
    if (bytes > USER_PREFERENCES_MAX_BYTES) {
      return c.json({ error: 'too_large', max: USER_PREFERENCES_MAX_BYTES, got: bytes }, 400);
    }

    const file = memoryFileFor(c);
    // The `.claude` dir is created lazily — a brand-new user has only an empty
    // workspace root (or none) until their first project clone.
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, payload.content, { mode: 0o600 });

    const body: UserPreferencesResponse = { content: payload.content };
    return c.json(body);
  });

  return router;
}
