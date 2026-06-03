import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AccessControlResponse, AllowedEmailDTO, AllowlistResponse } from 'shared/types';
import type { AuthVariables } from '../../src/auth/middleware';
import { createAccessRouter } from '../../src/routes/access';
import type { DbCall } from '../_helpers';
import { makeFakeDb } from '../_helpers';

function buildApp(fakeDb: ReturnType<typeof makeFakeDb>, role: 'admin' | 'user') {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(
    '*',
    createMiddleware(async (c, next) => {
      c.set('user', { id: 'u1', email: `${role}@x.com`, role } as unknown as never);
      c.set('authSession', null);
      await next();
    }),
  );
  app.route('/', createAccessRouter({ db: fakeDb.db }));
  return app;
}

describe('allowlist routes', () => {
  it('GET /allowlist returns listed emails', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ email: 'a@x.com', createdAt: new Date('2026-01-01T00:00:00Z') }]);
    const app = buildApp(fake, 'admin');
    const res = await app.request('/allowlist');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AllowlistResponse;
    expect(body.emails).toEqual([{ email: 'a@x.com', createdAt: '2026-01-01T00:00:00.000Z' }]);
  });

  it('POST /allowlist normalizes to lowercase and inserts', async () => {
    const fake = makeFakeDb();
    // read-back after insert
    fake.selectQueue.push([{ email: 'foo@bar.com', createdAt: new Date('2026-01-02T00:00:00Z') }]);
    const app = buildApp(fake, 'admin');
    const res = await app.request('/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  Foo@BAR.com ' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AllowedEmailDTO;
    expect(body.email).toBe('foo@bar.com');
    const insert = fake.calls.find((c: DbCall) => c.op === 'insert');
    expect((insert?.values as { email: string }).email).toBe('foo@bar.com');
  });

  it('POST /allowlist rejects an invalid email with 400', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, 'admin');
    const res = await app.request('/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /allowlist/:email removes by lowercased param', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, 'admin');
    const res = await app.request('/allowlist/Foo@Bar.com', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
    expect(fake.calls.some((c: DbCall) => c.op === 'delete')).toBe(true);
  });
});

describe('control routes', () => {
  it('GET /control reports override / envDefault / effective', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]);
    const app = buildApp(fake, 'admin');
    const res = await app.request('/control');
    const body = (await res.json()) as AccessControlResponse;
    expect(body).toEqual({ override: true, envDefault: true, effective: true });
  });

  it('PATCH /control sets override = false and round-trips', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, 'admin');
    const res = await app.request('/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccessControlResponse;
    expect(body).toEqual({ override: false, envDefault: true, effective: false });
    const insert = fake.calls.find((c: DbCall) => c.op === 'insert');
    expect((insert?.values as { id: number; enabled: boolean | null }).enabled).toBe(false);
  });

  it('PATCH /control accepts override = null (follow env)', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, 'admin');
    const res = await app.request('/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccessControlResponse;
    expect(body).toEqual({ override: null, envDefault: true, effective: true });
  });

  it('rejects a non-admin caller with 403', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, 'user');
    const res = await app.request('/control');
    expect(res.status).toBe(403);
  });
});
