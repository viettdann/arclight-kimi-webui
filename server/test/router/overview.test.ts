import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { OverviewResponse } from 'shared/types';
import { createOverviewRouter } from '../../src/routes/overview';
import { makeFakeDb } from '../_helpers';

const adminAuth = createMiddleware(async (c, next) => {
  c.set('user', { id: 'admin-1', email: 'admin@test.com', role: 'admin' } as unknown as never);
  c.set('authSession', null);
  await next();
});

const userAuth = createMiddleware(async (c, next) => {
  c.set('user', { id: 'user-1', email: 'user@test.com', role: 'user' } as unknown as never);
  c.set('authSession', null);
  await next();
});

const anonAuth = createMiddleware(async (c, next) => {
  c.set('user', null);
  c.set('authSession', null);
  await next();
});

function buildApp(
  fakeDb: ReturnType<typeof makeFakeDb>,
  authMw: ReturnType<typeof createMiddleware>,
  overrides: { wsClients?: number; sessions?: number; startedAt?: Date } = {},
) {
  const app = new Hono();
  app.use('*', authMw);
  app.route(
    '/',
    createOverviewRouter({
      db: fakeDb.db,
      manager: { size: overrides.sessions ?? 0 },
      wsClientCount: () => overrides.wsClients ?? 0,
      startedAt: overrides.startedAt ?? new Date('2026-01-01T00:00:00Z'),
    }),
  );
  return app;
}

describe('GET /api/admin/overview', () => {
  it('rejects anonymous with 401', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, anonAuth);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects non-admin user with 403', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, userAuth);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('returns populated payload for admin', async () => {
    const fake = makeFakeDb();
    // resolveAccessControl reads accessControl row (none → empty)
    fake.selectQueue.push([]);
    // allowedEmail count() row
    fake.selectQueue.push([{ n: 3 }]);

    const startedAt = new Date('2026-01-01T00:00:00Z');
    const app = buildApp(fake, adminAuth, { wsClients: 2, sessions: 1, startedAt });

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OverviewResponse;

    expect(body.runtime.startedAt).toBe(startedAt.toISOString());
    expect(body.runtime.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(body.runtime.nodeVersion).toBe(process.versions.node);
    expect(body.runtime.bunVersion).toBe(Bun.version);

    expect(body.db.ok).toBe(true);
    expect(body.db.latencyMs).toBeGreaterThanOrEqual(0);

    expect(body.ws.clients).toBe(2);
    expect(body.ws.sessions).toBe(1);

    expect(body.access.allowlistCount).toBe(3);
    expect(body.access.override).toBe(null);
    expect(typeof body.access.effective).toBe('boolean');
    expect(typeof body.access.envDefault).toBe('boolean');
  });

  it('treats empty allowlist count row as 0', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // accessControl
    fake.selectQueue.push([]); // count() — empty

    const app = buildApp(fake, adminAuth);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OverviewResponse;
    expect(body.access.allowlistCount).toBe(0);
  });
});
