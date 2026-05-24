import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createKimiConfigRouter } from '../../src/routes/kimi-config';
import { DEFAULT_KIMI_CONFIG } from '../../src/services/kimi-config/defaults';
import { makeFakeDb } from '../_helpers';

const mockAuth = createMiddleware(async (c, next) => {
  c.set('user', { id: 'admin-1', email: 'admin@test.com', role: 'admin' } as unknown as never);
  c.set('authSession', null);
  await next();
});

function buildApp(fakeDb: ReturnType<typeof makeFakeDb>) {
  const app = new Hono();
  app.use('*', mockAuth);
  app.route('/', createKimiConfigRouter({ db: fakeDb.db }));
  return app;
}

function makeFakeKimiConfigRow(apiKey: string) {
  return {
    id: 1,
    defaults: DEFAULT_KIMI_CONFIG.defaults,
    provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey },
    models: DEFAULT_KIMI_CONFIG.models,
    services: DEFAULT_KIMI_CONFIG.services,
    loopControl: DEFAULT_KIMI_CONFIG.loopControl,
    background: DEFAULT_KIMI_CONFIG.background,
    notifications: DEFAULT_KIMI_CONFIG.notifications,
    mcpClient: DEFAULT_KIMI_CONFIG.mcpClient,
    hooks: DEFAULT_KIMI_CONFIG.hooks,
    extraTomlOverride: '',
    updatedAt: new Date(),
  };
}

describe('GET /api/config', () => {
  it('masks apiKey in response', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);

    const app = buildApp(fake);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: { apiKey: string } };
    expect(body.provider.apiKey).toBe('***1234');
  });
});

describe('PATCH /api/config', () => {
  it('updates provider baseUrl and re-renders file', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);

    const app = buildApp(fake);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { baseUrl: 'https://new.example.com' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: { baseUrl: string; apiKey: string } };
    expect(body.provider.baseUrl).toBe('https://new.example.com');
    expect(body.provider.apiKey).toBe('***1234');

    const updateCall = fake.calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
  });

  it('leaves apiKey unchanged when null on PATCH', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);

    const app = buildApp(fake);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { apiKey: null, baseUrl: 'https://another.com' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: { apiKey: string; baseUrl: string } };
    expect(body.provider.apiKey).toBe('***1234');
    expect(body.provider.baseUrl).toBe('https://another.com');
  });

  it('rejects invalid provider type', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test')]);

    const app = buildApp(fake);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { type: 'invalid' } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/config/status', () => {
  it('reflects DB state when ready', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test')]);

    const app = buildApp(fake);
    const res = await app.request('/status', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean; authMode: string };
    expect(body.ready).toBe(true);
    expect(body.authMode).toBe('api_key');
  });
});

describe('POST /api/config/test', () => {
  it('returns ok for configured provider', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test')]);

    const app = buildApp(fake);
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body).toEqual({ ok: true });
  });

  it('returns missing fields when api key is empty', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('')]);

    const app = buildApp(fake);
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('provider.apiKey');
  });
});
