import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import type { ProjectListResponse, ProjectSummary } from 'shared/types';
import type { AuthVariables } from '../src/auth/middleware';
import type { AuditEvent } from '../src/lib/logger';
import { createProjectsRoutes } from '../src/routes/projects';
import { makeFakeDb } from './_helpers';

interface MockUser {
  id: string;
  email: string;
}

interface BuildOpts {
  user: MockUser | null;
  env: { WORKSPACE_ROOT: string };
  audit: AuditEvent[];
  /** Pre-seeded DB rows for the next `selectDistinct(projectName)` query. */
  dbProjectNames?: string[];
}

function buildApp(opts: BuildOpts): {
  app: Hono<{ Variables: AuthVariables }>;
  fake: ReturnType<typeof makeFakeDb>;
} {
  const fake = makeFakeDb();
  // Seed the DISTINCT projectName query so GET / has a deterministic DB side.
  fake.selectQueue.push((opts.dbProjectNames ?? []).map((name) => ({ projectName: name })));

  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', opts.user as any);
    c.set('authSession', null);
    await next();
  });
  app.route(
    '/api/projects',
    createProjectsRoutes({
      env: opts.env,
      auditLog: (e) => {
        opts.audit.push(e);
      },
      db: fake.db,
    }),
  );
  return { app, fake };
}

let tmpRoot: string;
let userRoot: string;
let audit: AuditEvent[];
let app: Hono<{ Variables: AuthVariables }>;
let fake: ReturnType<typeof makeFakeDb>;

const mockUser: MockUser = { id: 'u1', email: 'alice@example.com' };

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'kimi-projects-test-'));
  userRoot = path.join(tmpRoot, 'alice');
  audit = [];
  const built = buildApp({ user: mockUser, env: { WORKSPACE_ROOT: tmpRoot }, audit });
  app = built.app;
  fake = built.fake;
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ─────────────────────────── POST /api/projects ───────────────────────────

describe('POST /api/projects', () => {
  it('creates a project with slugified name and 0o700 mode + origin local', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectSummary;
    expect(body.name).toBe('hello-world');
    expect(body.workDir).toBe(path.join(userRoot, 'hello-world'));
    expect(body.origin).toBe('local');

    const s = await stat(body.workDir);
    expect(s.isDirectory()).toBe(true);
    expect(s.mode & 0o777).toBe(0o700);
  });

  it('appends -2 on collision with same name', async () => {
    const r1 = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World' }),
    });
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as ProjectSummary;
    expect(b1.name).toBe('hello-world');

    const r2 = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World' }),
    });
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as ProjectSummary;
    expect(b2.name).toBe('hello-world-2');

    const s = await stat(b2.workDir);
    expect(s.isDirectory()).toBe(true);
  });

  it('strips Vietnamese diacritics via NFD normalize', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dự án A' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectSummary;
    expect(body.name).toBe('du-an-a');
  });

  it('rejects whitespace-only name', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  ' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('rejects all-symbol name', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '!@#' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('rejects all-dash name', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '---' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('rejects "."', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '.' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('rejects ".."', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '..' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('rejects > 60 char name', async () => {
    const longName = 'a'.repeat(61);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: longName }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('"../escape" sanitizes to "escape" and stays inside userRoot', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '../escape' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectSummary;
    expect(body.name).toBe('escape');
    expect(path.dirname(body.workDir)).toBe(userRoot);

    const s = await stat(body.workDir);
    expect(s.isDirectory()).toBe(true);
  });

  it('returns 401 when no user is set', async () => {
    const localApp = buildApp({ user: null, env: { WORKSPACE_ROOT: tmpRoot }, audit }).app;
    const res = await localApp.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('returns 400 when name is not a string', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('emits audit event with action=project_create', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World' }),
    });
    expect(res.status).toBe(201);
    expect(audit).toContainEqual({
      userId: 'u1',
      action: 'project_create',
      path: 'hello-world',
      bytes: 0,
    });
  });
});

// ─────────────────────────── GET /api/projects ───────────────────────────

describe('GET /api/projects', () => {
  it('returns empty list when no projects exist', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProjectListResponse;
    expect(body.projects).toEqual([]);
  });

  it('returns directories only (skips plain files), sorted ASC', async () => {
    // userRoot is created lazily by the handler, but we need to seed dirs/files
    // first. Force-create it now and populate.
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'proj-b'), { mode: 0o700 });
    await mkdir(path.join(userRoot, 'proj-a'), { mode: 0o700 });
    await writeFile(path.join(userRoot, 'file.txt'), 'ignored');

    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProjectListResponse;
    expect(body.projects.map((p) => p.name)).toEqual(['proj-a', 'proj-b']);
    expect(body.projects[0]?.workDir).toBe(path.join(userRoot, 'proj-a'));
    expect(body.projects[1]?.workDir).toBe(path.join(userRoot, 'proj-b'));
  });

  it('returns 401 when no user is set', async () => {
    const localApp = buildApp({ user: null, env: { WORKSPACE_ROOT: tmpRoot }, audit }).app;
    const res = await localApp.request('/api/projects');
    expect(res.status).toBe(401);
  });

  it('returns union of FS dirs and DB projectNames with origin populated', async () => {
    // FS has `alpha`; DB has `alpha` (overlap → local wins) and `beta` (foreign).
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(path.join(userRoot, 'alpha'), { mode: 0o700 });

    // Override the seeded empty DB rows for this request.
    fake.selectQueue.length = 0;
    fake.selectQueue.push([{ projectName: 'alpha' }, { projectName: 'beta' }]);

    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProjectListResponse;
    expect(body.projects).toEqual([
      { name: 'alpha', workDir: path.join(userRoot, 'alpha'), origin: 'local' },
      { name: 'beta', workDir: path.join(userRoot, 'beta'), origin: 'foreign' },
    ]);
  });
});
