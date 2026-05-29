import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import type { ProjectCreateResponse } from 'shared/types';
import type { AuthVariables } from '../src/auth/middleware';
import type { AuditEvent } from '../src/lib/logger';
import { createProjectsRoutes } from '../src/routes/projects';
import type { CloneResult } from '../src/services/git/clone';
import { makeFakeDb } from './_helpers';

type CloneStub = () => Promise<CloneResult>;

let tmpRoot: string;
let userRoot: string;
let audit: AuditEvent[];

const mockUser = { id: 'u1', email: 'alice@example.com' };

function buildApp(cloneRepo: CloneStub): Hono<{ Variables: AuthVariables }> {
  const fake = makeFakeDb();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', mockUser as never);
    c.set('authSession', null);
    await next();
  });
  app.route(
    '/api/projects',
    createProjectsRoutes({
      env: { WORKSPACE_ROOT: tmpRoot, GIT_CLONE_TIMEOUT_MS: 1000 },
      auditLog: (e) => {
        audit.push(e);
      },
      db: fake.db,
      cloneRepo: cloneRepo as never,
    }),
  );
  return app;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const cloneBody = (sourceOver: Record<string, unknown> = {}, name?: string): string =>
  JSON.stringify({
    ...(name === undefined ? {} : { name }),
    source: {
      type: 'clone',
      url: 'https://github.com/acme/widgets.git',
      inlineToken: 'tok',
      provider: 'github',
      ...sourceOver,
    },
  });

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'kimi-projects-clone-test-'));
  userRoot = path.join(tmpRoot, 'alice');
  audit = [];
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/projects clone flow', () => {
  it('clones into a derived-name dir on success', async () => {
    const app = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;
    expect(body.name).toBe('widgets');
    expect(body.origin).toBe('local');
    expect(body.workDir).toBe(path.join(userRoot, 'widgets'));

    const s = await stat(body.workDir);
    expect(s.isDirectory()).toBe(true);

    expect(audit).toContainEqual({
      userId: 'u1',
      action: 'project_create',
      path: 'widgets',
      bytes: 0,
    });
  });

  it('rolls back the dir and returns 502 on clone_failed', async () => {
    const app = buildApp(async () => ({ ok: false, kind: 'clone_failed', error: 'boom' }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(502);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'clone_failed' });
    expect(await exists(path.join(userRoot, 'widgets'))).toBe(false);
  });

  it('rolls back the dir and returns 504 on clone_timeout', async () => {
    const app = buildApp(async () => ({ ok: false, kind: 'clone_timeout', error: 't/o' }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(504);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'clone_timeout' });
    expect(await exists(path.join(userRoot, 'widgets'))).toBe(false);
  });

  it('uses an explicit slugified name over the derived one', async () => {
    const app = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({}, 'Custom Name'),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;
    expect(body.name).toBe('custom-name');
  });

  it('rejects an scp-style url with 400 invalid_url', async () => {
    const app = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({ url: 'git@github.com:acme/widgets.git' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_url' });
  });

  it('rejects an ssh:// url with 400 unsupported_scheme', async () => {
    const app = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({ url: 'ssh://git@h/o/r.git' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_scheme' });
  });
});

describe('POST /api/projects blank flow (no regression)', () => {
  it('creates a blank project without invoking cloneRepo', async () => {
    let cloneCalled = false;
    const app = buildApp(async () => {
      cloneCalled = true;
      return { ok: true };
    });
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;
    expect(body.name).toBe('hello-world');
    expect(cloneCalled).toBe(false);

    const s = await stat(body.workDir);
    expect(s.isDirectory()).toBe(true);
  });
});
