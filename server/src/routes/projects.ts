import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectListResponse,
} from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { db as defaultDb, type DB } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { slugifyProjectName } from '../lib/slug';
import { auditLog as defaultAuditLog } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';
import { listProjectsForUser } from '../services/projects';

export interface ProjectsRoutesDeps {
  env: Pick<Env, 'WORKSPACE_ROOT'>;
  auditLog: typeof defaultAuditLog;
  db?: DB;
}

const MAX_COLLISION_RETRIES = 100;

export function createProjectsRoutes(deps: ProjectsRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const { env, auditLog } = deps;
  const db = deps.db ?? defaultDb;

  const projects = new Hono<{ Variables: AuthVariables }>();
  projects.use('*', requireAuth);

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

    const rawName = (body as Partial<ProjectCreateRequest>).name;
    if (typeof rawName !== 'string') {
      return c.json({ error: 'invalid_name' }, 400);
    }

    const base = slugifyProjectName(rawName);
    if (base === null) {
      return c.json({ error: 'invalid_name' }, 400);
    }

    // `slug()` matches the auth `databaseHooks.user.create.after` hook so the
    // dir we mkdir/list here is the same one auth created at sign-up.
    const userRoot = path.join(env.WORKSPACE_ROOT, slug(user.email ?? ''));
    await mkdir(userRoot, { recursive: true, mode: 0o700 });

    let finalSlug: string | null = null;
    let finalAbs: string | null = null;
    for (let i = 1; i <= MAX_COLLISION_RETRIES; i += 1) {
      const tryName = i === 1 ? base : `${base}-${i}`;

      let abs: string;
      try {
        abs = await resolveUserPath(userRoot, tryName);
      } catch {
        return c.json({ error: 'server_error' }, 500);
      }

      try {
        await mkdir(abs, { recursive: false, mode: 0o700 });
        finalSlug = tryName;
        finalAbs = abs;
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          continue;
        }
        throw err;
      }
    }

    if (finalSlug === null || finalAbs === null) {
      return c.json({ error: 'server_error' }, 500);
    }

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
