import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  CloneErrorCode,
  CloneProgressPayload,
  GitCloneSource,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectDeleteResponse,
  ProjectListResponse,
  ProjectStatResponse,
} from 'shared/types';
import { type GitProvider, isGitProvider } from 'shared/types/git-credentials';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';
import { slugifyProjectName } from '../lib/slug';
import { broadcastToUser } from '../lib/ws-broadcast';
import { cloneRepo as defaultCloneRepo } from '../services/git/clone';
import {
  cancelCloneForProject,
  registerClone,
  unregisterClone,
} from '../services/git/clone-registry';
import { CloneUrlError, deriveRepoName, parseCloneUrl } from '../services/git/url';
import { getOwned } from '../services/git-credentials/repo';
import {
  deleteProjectForUser,
  listProjectsForUser,
  statProjectForUser,
} from '../services/projects';
import { sessionManager as defaultManager, type SessionManager } from '../services/session-manager';

export interface ProjectsRoutesDeps {
  env: Pick<Env, 'WORKSPACE_ROOT'> & { GIT_CLONE_TIMEOUT_MS?: number };
  auditLog: typeof defaultAuditLog;
  db?: DB;
  cloneRepo?: typeof defaultCloneRepo;
  manager?: SessionManager;
  /** Push a clone-progress frame to every socket of the cloning user. Injected
   *  in tests to observe the async clone outcome without a live WebSocket. */
  notifyCloneProgress?: (userId: string, payload: CloneProgressPayload) => void;
}

const MAX_COLLISION_RETRIES = 100;

export function createProjectsRoutes(deps: ProjectsRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const { env, auditLog } = deps;
  const db = deps.db ?? defaultDb;
  const cloneRepo = deps.cloneRepo ?? defaultCloneRepo;
  const manager = deps.manager ?? defaultManager;
  const notifyCloneProgress =
    deps.notifyCloneProgress ??
    ((userId: string, payload: CloneProgressPayload) =>
      broadcastToUser(userId, 'clone_progress', payload));

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

      // 5. Clone in the background. The HTTP response returns immediately with a
      // `cloneId`; objects are fetched out-of-band and progress is streamed to
      // the user's sockets via `clone_progress`. The folder is already claimed,
      // so a foreign refresh sees the project as it fills (then it goes ready).
      const cloneId = randomUUID();
      const userId = user.id;
      // Every frame carries workDir so a fresh listener (other tab, post-refresh)
      // can build the sidebar row from any frame, not just the terminal one.
      const notify = (p: Omit<CloneProgressPayload, 'cloneId' | 'projectName' | 'workDir'>) =>
        notifyCloneProgress(userId, { cloneId, projectName: finalSlug, workDir: finalAbs, ...p });
      // Roll back the claimed dir, then report. rm is guarded so a cleanup
      // failure never reclassifies the original errorCode (e.g. a timeout whose
      // rm throws must still report `clone_timeout`, not `clone_failed`).
      const failClone = async (error: string, errorCode: CloneErrorCode) => {
        await rm(finalAbs, { recursive: true, force: true }).catch(() => {});
        notify({ phase: 'Failed', percent: null, status: 'failed', error, errorCode });
      };

      // Register for cancellation, and drop a marker so an interrupted clone
      // (process killed mid-fetch) is cleaned up on the next startup. The marker
      // lives beside the project (clone needs an empty target dir), keyed by slug.
      const controller = new AbortController();
      registerClone(cloneId, { controller, userId, projectName: finalSlug, workDir: finalAbs });
      const markerPath = path.join(path.dirname(finalAbs), `.cloning-${finalSlug}`);
      await writeFile(markerPath, '').catch(() => {});

      void (async () => {
        try {
          const result = await cloneRepo({
            url: cs.url,
            targetDir: finalAbs,
            provider,
            token,
            timeoutMs,
            signal: controller.signal,
            onProgress: ({ phase, percent }) => notify({ phase, percent, status: 'cloning' }),
          });
          if (!result.ok) {
            // A user-initiated abort surfaces as a failed clone; report it as a
            // cancellation (terminal, but not an error the client should toast).
            await failClone(
              result.error,
              controller.signal.aborted ? 'clone_canceled' : result.kind,
            );
            return;
          }
          auditLog({ userId, action: 'project_create', path: finalSlug, bytes: 0 });
          notify({ phase: 'Done', percent: 100, status: 'completed' });
        } catch (err) {
          await failClone(
            err instanceof Error ? err.message : 'clone failed',
            controller.signal.aborted ? 'clone_canceled' : 'clone_failed',
          );
        } finally {
          unregisterClone(cloneId);
          await rm(markerPath, { force: true }).catch(() => {});
        }
      })();

      // 6. Accepted: clone is underway.
      return c.json(
        {
          name: finalSlug,
          workDir: finalAbs,
          origin: 'local',
          cloneId,
          status: 'cloning',
        } satisfies ProjectCreateResponse,
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

  // ─────────────────────── GET /:name/stat ───────────────────────
  // Lazy snapshot for the delete dialog: existence, top-level entry count, and
  // a cheap git summary. No recursive scan.

  projects.get('/:name/stat', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const stat = await statProjectForUser({
      userEmail: user.email ?? '',
      projectName: c.req.param('name'),
      env,
    });
    return c.json(stat satisfies ProjectStatResponse);
  });

  // ─────────────────────── DELETE /:name/clone ───────────────────────
  // Cancel an in-flight background clone of this project. Aborts the git
  // subprocess; the background task then rolls back the claimed folder and
  // pushes a terminal `clone_canceled` frame. No-op (404) if nothing is cloning.

  projects.delete('/:name/clone', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const canceled = cancelCloneForProject(user.id, c.req.param('name'));
    if (!canceled) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  // ─────────────────────────── DELETE /:name ───────────────────────────
  // Hard-delete the project + all its sessions: DB-first (cascade drops the
  // JSONL restore source), then best-effort disk cleanup (transcript dirs +
  // workspace). See `deleteProjectForUser` for the crash-safe ordering.

  projects.delete('/:name', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const result = await deleteProjectForUser({
      userId: user.id,
      userEmail: user.email ?? '',
      projectName: c.req.param('name'),
      db,
      env,
      manager,
      auditLog,
    });
    if (result === 'not_found') return c.json({ error: 'not_found' }, 404);

    return c.json({ ok: true, sessionCount: result.sessionCount } satisfies ProjectDeleteResponse);
  });

  return projects;
}

export default createProjectsRoutes({ env: defaultEnv, auditLog: defaultAuditLog });
