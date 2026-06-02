import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AuthVariables } from '../../src/auth/middleware';
import { createProjectDiscoveryRouter } from '../../src/routes/project-discovery';
import { SITE_SETTING_KEYS } from '../../src/services/site-settings';
import { makeFakeDb } from '../_helpers';

const ENTRIES_KEY = SITE_SETTING_KEYS.projectDiscoveryEntries;
const OVERRIDE_KEY = SITE_SETTING_KEYS.projectDiscoveryOverride;

function buildApp(
  fakeDb: ReturnType<typeof makeFakeDb>,
  user: { email: string; role: string } | null,
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(
    '*',
    createMiddleware(async (c, next) => {
      c.set('user', (user as unknown as never) ?? null);
      c.set('authSession', null);
      await next();
    }),
  );
  app.route('/', createProjectDiscoveryRouter({ db: fakeDb.db }));
  return app;
}

const ADMIN = { email: 'admin@x.com', role: 'admin' };

describe('GET /api/admin/project-discovery', () => {
  it('falls back to code defaults when no rows exist', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // site_settings query → no rows
    const app = buildApp(fake, ADMIN);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], override: false });
  });

  it('returns stored values when rows exist', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      { key: ENTRIES_KEY, value: ['custom'] },
      { key: OVERRIDE_KEY, value: true },
    ]);
    const app = buildApp(fake, ADMIN);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: ['custom'], override: true });
  });

  it('rejects a non-admin user with 403', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, { email: 'user@x.com', role: 'user' });
    const res = await app.request('/');
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, null);
    const res = await app.request('/');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/admin/project-discovery', () => {
  it('upserts both rows and echoes the saved config', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, ADMIN);

    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: ['foo'], override: false }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: ['foo'], override: false });

    const inserts = fake.calls.filter((c) => c.op === 'insert');
    expect(inserts.length).toBe(1);
    // One batched insert with exactly the two project-discovery rows.
    expect(inserts[0]?.values).toEqual([
      { key: ENTRIES_KEY, value: ['foo'] },
      { key: OVERRIDE_KEY, value: false },
    ]);
  });

  it('rejects a non-boolean override', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, ADMIN);
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [], override: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_override' });
  });

  it('rejects non-array entries', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, ADMIN);
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: 'not-array', override: false }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_entries' });
  });

  it('rejects entries containing non-strings', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, ADMIN);
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: ['ok', 123], override: false }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_entries' });
  });

  it('rejects invalid json', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, ADMIN);
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('rejects a non-admin user with 403 and writes nothing', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, { email: 'user@x.com', role: 'user' });
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [], override: false }),
    });
    expect(res.status).toBe(403);
    expect(fake.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });
});
