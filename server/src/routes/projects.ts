import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type {
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectListResponse,
  ProjectSummary,
} from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';

export interface ProjectsRoutesDeps {
  env: Pick<Env, 'WORKSPACE_ROOT'>;
  auditLog: typeof defaultAuditLog;
}

interface UserCtx {
  userId: string;
  userRoot: string;
}

const MAX_NAME_LEN = 60;
const MAX_COLLISION_RETRIES = 100;

// Slug rules: trim → NFD normalize → strip combining marks → lowercase →
// replace any non-[a-z0-9_-] with '-' → collapse runs → strip leading/trailing
// '-'. Returns null if the result would be empty, would equal '.' / '..',
// or if the trimmed input exceeds MAX_NAME_LEN. The output is therefore safe
// to use as a single path segment under userRoot.
function slugify(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) return null;

  const slug = trimmed
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) return null;
  if (slug === '.' || slug === '..') return null;
  return slug;
}

export function createProjectsRoutes(deps: ProjectsRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const { env, auditLog } = deps;

  const projects = new Hono<{ Variables: AuthVariables }>();
  projects.use('*', requireAuth);

  async function userCtx(email: string | null | undefined, userId: string): Promise<UserCtx> {
    // `slug()` matches the auth `databaseHooks.user.create.after` hook so the
    // dir we mkdir/list here is the same one auth created at sign-up. A naive
    // `split('@')[0]` would diverge for emails with uppercase or chars outside
    // `[a-z0-9._-]` (e.g. Microsoft `Firstname.Lastname@…`), pointing this
    // route at a non-existent directory.
    const userRoot = path.join(env.WORKSPACE_ROOT, slug(email ?? ''));
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    return { userId, userRoot };
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

    const rawName = (body as Partial<ProjectCreateRequest>).name;
    if (typeof rawName !== 'string') {
      return c.json({ error: 'invalid_name' }, 400);
    }

    const base = slugify(rawName);
    if (base === null) {
      return c.json({ error: 'invalid_name' }, 400);
    }

    const ctx = await userCtx(user.email, user.id);

    let finalSlug: string | null = null;
    let finalAbs: string | null = null;
    for (let i = 1; i <= MAX_COLLISION_RETRIES; i += 1) {
      const tryName = i === 1 ? base : `${base}-${i}`;

      let abs: string;
      try {
        abs = await resolveUserPath(ctx.userRoot, tryName);
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

    auditLog({ userId: ctx.userId, action: 'project_create', path: finalSlug, bytes: 0 });

    const responseBody: ProjectCreateResponse = { name: finalSlug, workDir: finalAbs };
    return c.json(responseBody, 201);
  });

  // ─────────────────────────── GET / ───────────────────────────

  projects.get('/', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const ctx = await userCtx(user.email, user.id);

    const dirents = await readdir(ctx.userRoot, { withFileTypes: true });
    const collator = new Intl.Collator(undefined, { numeric: true });
    const sorted = dirents
      .filter((d) => d.isDirectory())
      .sort((a, b) => collator.compare(a.name, b.name));

    const items: ProjectSummary[] = sorted.map((d) => ({
      name: d.name,
      workDir: path.join(ctx.userRoot, d.name),
    }));

    const body: ProjectListResponse = { projects: items };
    return c.json(body);
  });

  return projects;
}

export default createProjectsRoutes({ env: defaultEnv, auditLog: defaultAuditLog });
