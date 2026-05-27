import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { MeResponse } from 'shared/types';
import type { AuthVariables } from '../../src/auth/middleware';
import { createMeRouter } from '../../src/routes/me';
import { makeFakeDb } from '../_helpers';

function buildApp(fakeDb: ReturnType<typeof makeFakeDb>, user: { email: string; role: string }) {
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
