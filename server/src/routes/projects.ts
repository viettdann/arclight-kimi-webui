import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  GitCloneSource,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectListResponse,
} from 'shared/types';
import { type GitProvider, isGitProvider } from 'shared/types/git-credentials';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';
import { slugifyProjectName } from '../lib/slug';
import { cloneRepo as defaultCloneRepo } from '../services/git/clone';
import { CloneUrlError, deriveRepoName, parseCloneUrl } from '../services/git/url';
import { getOwned } from '../services/git-credentials/repo';
import { listProjectsForUser } from '../services/projects';

export interface ProjectsRoutesDeps {
  env: Pick<Env, 'WORKSPACE_ROOT'> & { GIT_CLONE_TIMEOUT_MS?: number };
  auditLog: typeof defaultAuditLog;
  db?: DB;
  cloneRepo?: typeof defaultCloneRepo;
}

const MAX_COLLISION_RETRIES = 100;

export function createProjectsRoutes(deps: ProjectsRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const { env, auditLog } = deps;
  const db = deps.db ?? defaultDb;
  const cloneRepo = deps.cloneRepo ?? defaultCloneRepo;

  const timeoutMs = deps.env.GIT_CLONE_TIMEOUT_MS ?? 120_000;

  const projects = new Hono<{ Variables: AuthVariables }>();
  projects.use('*', requireAuth);

  // Claim an empty project directory under the user's workspace root. Tries
  // `base`, then `base-2`, `base-3`, …, mkdir-ing non-recursively so an EEXIST
  // collision moves to the next candidate. Returns null only on exhaustion.
  async function claimProjectDir(
    userEmail: string,
    base: string,
  ): Promise<{ slug: string; abs: string } | null | 'resolve_error'> {
    // `slug()` matches the auth `databaseHooks.user.create.after` hook so the
    // dir we mkdir/list here is the same one auth created at sign-up.
    const userRoot = path.join(env.WORKSPACE_ROOT, slug(userEmail));
    await mkdir(userRoot, { recursive: true, mode: 0o700 });

    for (let i = 1; i <= MAX_COLLISION_RETRIES; i += 1) {
      const tryName = i === 1 ? base : `${base}-${i}`;

      let abs: string;
      try {
        abs = await resolveUserPath(userRoot, tryName);
      } catch {
        return 'resolve_error';
      }

      try {
        await mkdir(abs, { recursive: false, mode: 0o700 });
        return { slug: tryName, abs };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          continue;
        }
        throw err;
      }
    }

    return null;
  }

  // ─────────────────────────── POST / ───────────────────────────

  projects.post('/', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_name' }, 400);
    }

    if (body == null || typeof body !== 'object') {
      return c.json({ error: 'invalid_name' }, 400);
    }

    const source = (body as Partial<ProjectCreateRequest>).source;
    const isClone =
      source != null &&
      typeof source === 'object' &&
      (source as { type?: unknown }).type === 'clone';

    if (isClone) {
      const cs = source as GitCloneSource;

      // 1. Validate URL.
      if (typeof cs.url !== 'string') {
        return c.json({ error: 'invalid_url' }, 400);
      }
      try {
        parseCloneUrl(cs.url);
      } catch (e) {
        if (e instanceof CloneUrlError && e.code === 'unsupported_scheme') {
          return c.json({ error: 'unsupported_scheme' }, 400);
        }
        return c.json({ error: 'invalid_url' }, 400);
      }

      // 2. Resolve credential.
      let provider: GitProvider;
      let token: string;
      if (cs.credentialId) {
        const row = await getOwned(db, user.id, cs.credentialId);
        if (!row) return c.json({ error: 'credential_not_found' }, 400);
        if (!isGitProvider(row.provider)) return c.json({ error: 'invalid_provider' }, 400);
        provider = row.provider;
        token = row.token;
      } else if (cs.inlineToken && cs.provider) {
        if (!isGitProvider(cs.provider)) return c.json({ error: 'invalid_provider' }, 400);
        provider = cs.provider;
        token = cs.inlineToken;
      } else {
        return c.json({ error: 'credential_not_found' }, 400);
      }

      // 3. Derive project name.
      const nameField = (body as ProjectCreateRequest).name;
      const rawName =
        typeof nameField === 'string' && nameField.trim().length > 0
          ? nameField
          : deriveRepoName(cs.url);
      if (rawName == null) return c.json({ error: 'invalid_name' }, 400);
      const base = slugifyProjectName(rawName);
      if (base === null) return c.json({ error: 'invalid_name' }, 400);

      // 4. Claim an empty target dir.
      const claimed = await claimProjectDir(user.email ?? '', base);
      if (claimed === 'resolve_error' || claimed === null) {
        return c.json({ error: 'server_error' }, 500);
      }
      const { slug: finalSlug, abs: finalAbs } = claimed;

      // 5. Clone into it.
      const result = await cloneRepo({
        url: cs.url,
        targetDir: finalAbs,
        provider,
        token,
        timeoutMs,
      });
      if (!result.ok) {
        await rm(finalAbs, { recursive: true, force: true });
        if (result.kind === 'clone_timeout') {
          return c.json({ error: 'clone_timeout', detail: result.error }, 504);
        }
        return c.json({ error: 'clone_failed', detail: result.error }, 502);
      }

      // 6. Success.
      auditLog({ userId: user.id, action: 'project_create', path: finalSlug, bytes: 0 });
      return c.json(
        { name: finalSlug, workDir: finalAbs, origin: 'local' } satisfies ProjectCreateResponse,
        201,
      );
    }

    // ── Blank flow ──
    const rawName = (body as Partial<ProjectCreateRequest>).name;
    if (typeof rawName !== 'string') {
      return c.json({ error: 'invalid_name' }, 400);
    }

    const base = slugifyProjectName(rawName);
    if (base === null) {
      return c.json({ error: 'invalid_name' }, 400);
    }

    const claimed = await claimProjectDir(user.email ?? '', base);
    if (claimed === 'resolve_error' || claimed === null) {
      return c.json({ error: 'server_error' }, 500);
    }
    const { slug: finalSlug, abs: finalAbs } = claimed;

    auditLog({ userId: user.id, action: 'project_create', path: finalSlug, bytes: 0 });

    const responseBody: ProjectCreateResponse = {
      name: finalSlug,
      workDir: finalAbs,
      origin: 'local',
    };
    return c.json(responseBody, 201);
  });

  // ─────────────────────────── GET / ───────────────────────────

  projects.get('/', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const items = await listProjectsForUser({
      userId: user.id,
      userEmail: user.email ?? '',
      db,
      env,
    });

    const body: ProjectListResponse = { projects: items };
    return c.json(body);
  });

  return projects;
}

export default createProjectsRoutes({ env: defaultEnv, auditLog: defaultAuditLog });
