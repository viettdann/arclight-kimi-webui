import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { MeResponse, UserPreferencesResponse } from 'shared/types';
import { USER_PREFERENCES_MAX_BYTES } from 'shared/types';
import { slug } from '../../src/auth';
import type { AuthVariables } from '../../src/auth/middleware';
import { createMeRouter } from '../../src/routes/me';
import { userMemoryPath } from '../../src/services/agent/agent-paths';
import { makeFakeDb } from '../_helpers';

function buildApp(
  fakeDb: ReturnType<typeof makeFakeDb>,
  user: { id?: string; email: string; role: string },
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(
    '*',
    createMiddleware(async (c, next) => {
      c.set('user', user as unknown as never);
      c.set('authSession', null);
      await next();
    }),
  );
  app.route('/', createMeRouter({ db: fakeDb.db }));
  return app;
}

describe('GET /api/me', () => {
  it('admin is allowed (control on)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    const app = buildApp(fake, { email: 'admin@x.com', role: 'admin' });
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body).toEqual({ role: 'admin', allowed: true });
  });

  it('listed user is allowed (control on)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    fake.selectQueue.push([{ email: 'user@x.com' }]); // allowlist
    const app = buildApp(fake, { email: 'user@x.com', role: 'user' });
    const res = await app.request('/', { method: 'GET' });
    const body = (await res.json()) as MeResponse;
    expect(body).toEqual({ role: 'user', allowed: true });
  });

  it('unlisted user is not allowed (control on)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    fake.selectQueue.push([]); // allowlist miss
    const app = buildApp(fake, { email: 'nope@x.com', role: 'user' });
    const res = await app.request('/', { method: 'GET' });
    const body = (await res.json()) as MeResponse;
    expect(body).toEqual({ role: 'user', allowed: false });
  });

  it('everyone is allowed when control is off', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: false }]); // control off
    const app = buildApp(fake, { email: 'nope@x.com', role: 'user' });
    const res = await app.request('/', { method: 'GET' });
    const body = (await res.json()) as MeResponse;
    expect(body).toEqual({ role: 'user', allowed: true });
  });

  it('rejects an unauthenticated request with 401', async () => {
    const fake = makeFakeDb();
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use(
      '*',
      createMiddleware(async (c, next) => {
        c.set('user', null);
        c.set('authSession', null);
        await next();
      }),
    );
    app.route('/', createMeRouter({ db: fake.db }));
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});

// The preferences endpoints exercise real disk IO under the test WORKSPACE_ROOT
// (`/tmp/mtc-webui-test`, set by setup.ts). Each case uses a distinct email so
// its `userMemoryPath` is isolated, and we clean those files up afterwards so
// the test is order-independent within this file.
describe('GET/PUT /api/me/preferences', () => {
  const touched = new Set<string>();

  function appFor(email: string) {
    const fake = makeFakeDb();
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use(
      '*',
      createMiddleware(async (c, next) => {
        c.set('user', { email, role: 'user' } as unknown as never);
        c.set('authSession', null);
        await next();
      }),
    );
    app.route('/', createMeRouter({ db: fake.db }));
    return app;
  }

  function fileFor(email: string): string {
    const file = userMemoryPath(slug(email));
    touched.add(file);
    return file;
  }

  afterEach(async () => {
    // Remove each user's `.claude` dir (parent of the memory file) so writes
    // from one case never leak into another.
    await Promise.all(
      [...touched].map((file) => rm(path.dirname(file), { recursive: true, force: true })),
    );
    touched.clear();
  });

  it('GET returns empty content when the file does not exist yet', async () => {
    const app = appFor('fresh@x.com');
    fileFor('fresh@x.com');
    const res = await app.request('/preferences', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserPreferencesResponse;
    expect(body).toEqual({ content: '' });
  });

  it('GET reads back an existing memory file', async () => {
    const file = fileFor('reader@x.com');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'always call me Dan');
    const app = appFor('reader@x.com');
    const res = await app.request('/preferences', { method: 'GET' });
    const body = (await res.json()) as UserPreferencesResponse;
    expect(body).toEqual({ content: 'always call me Dan' });
  });

  it('PUT creates the file (and its .claude dir) then GET reads it back', async () => {
    const email = 'writer@x.com';
    const file = fileFor(email);
    const app = appFor(email);

    const put = await app.request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'prefer terse answers' }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()) as UserPreferencesResponse).toEqual({
      content: 'prefer terse answers',
    });

    // Written to the exact per-user path…
    expect(await readFile(file, 'utf8')).toBe('prefer terse answers');
    // …and the GET route reads the same file.
    const get = await app.request('/preferences', { method: 'GET' });
    expect((await get.json()) as UserPreferencesResponse).toEqual({
      content: 'prefer terse answers',
    });
  });

  it('PUT rejects content over the byte cap with 400 and writes nothing', async () => {
    const email = 'toobig@x.com';
    const file = fileFor(email);
    const app = appFor(email);
    const oversized = 'x'.repeat(USER_PREFERENCES_MAX_BYTES + 1);

    const res = await app.request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: oversized }),
    });
    expect(res.status).toBe(400);
    // Nothing persisted.
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('PUT rejects a non-string content with 400', async () => {
    const app = appFor('badtype@x.com');
    fileFor('badtype@x.com');
    const res = await app.request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('routes two users to distinct files (no cross-write)', async () => {
    const fileA = fileFor('alice@x.com');
    const fileB = fileFor('bob@x.com');
    expect(fileA).not.toBe(fileB);

    await appFor('alice@x.com').request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: "alice's prefs" }),
    });
    await appFor('bob@x.com').request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: "bob's prefs" }),
    });

    expect(await readFile(fileA, 'utf8')).toBe("alice's prefs");
    expect(await readFile(fileB, 'utf8')).toBe("bob's prefs");
  });

  it('accepts content exactly at the byte cap', async () => {
    const email = 'atcap@x.com';
    const file = fileFor(email);
    const app = appFor(email);
    const exact = 'y'.repeat(USER_PREFERENCES_MAX_BYTES);

    const res = await app.request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: exact }),
    });
    expect(res.status).toBe(200);
    expect((await readFile(file, 'utf8')).length).toBe(USER_PREFERENCES_MAX_BYTES);
  });
});
