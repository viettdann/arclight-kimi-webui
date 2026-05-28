import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

/**
 * Allocate a tmp shareDir for a test. PATCH and sync-toml routes call
 * `writeConfigToml(_, shareDir)`; if `shareDir` were undefined those
 * routes would fall back to `resolveShareDir()` → the real project
 * `.kimi/` directory, polluting dev state. Tests must always inject a
 * tmp dir and clean it up.
 */
function makeTmpShareDir(): string {
  return path.join(
    tmpdir(),
    `kimi-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function buildApp(
  fakeDb: ReturnType<typeof makeFakeDb>,
  fetchFn?: typeof fetch,
  shareDir?: string,
) {
  const effectiveFetch =
    fetchFn ??
    ((async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch);
  const effectiveShareDir = shareDir ?? makeTmpShareDir();
  const app = new Hono();
  app.use('*', mockAuth);
  app.route(
    '/',
    createKimiConfigRouter({ db: fakeDb.db, fetchFn: effectiveFetch, shareDir: effectiveShareDir }),
  );
  return { app, shareDir: effectiveShareDir };
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

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: { apiKey: string } };
      expect(body.provider.apiKey).toBe('***1234');
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });
});

describe('PATCH /api/config', () => {
  it('updates provider baseUrl and re-renders file', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: { baseUrl: 'https://new.example.com' } }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: { baseUrl: string; apiKey: string } };
      expect(body.provider.baseUrl).toBe('https://new.example.com');
      expect(body.provider.apiKey).toBe('***1234');

      // PATCH is implemented as `insert().onConflictDoUpdate(...)`; the fake DB
      // records the call as a single `insert`.
      const insertCall = fake.calls.find((c) => c.op === 'insert');
      expect(insertCall).toBeDefined();
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });

  it('leaves apiKey unchanged when null on PATCH', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test1234')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: { apiKey: null, baseUrl: 'https://another.com' } }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: { apiKey: string; baseUrl: string } };
      expect(body.provider.apiKey).toBe('***1234');
      expect(body.provider.baseUrl).toBe('https://another.com');

      const insertCall = fake.calls.find((c) => c.op === 'insert');
      expect(insertCall).toBeDefined();
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid provider type', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: { type: 'invalid' } }),
      });
      expect(res.status).toBe(400);
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });

  it('PATCH on empty DB folds defaults + patch into the upsert', async () => {
    const fake = makeFakeDb();
    // First SELECT (PATCH path): no row present — getKimiConfig falls back to
    // env/defaults. Second SELECT (subsequent GET): simulate the post-upsert
    // row so the GET reflects the patched state.
    fake.selectQueue.push([]);
    fake.selectQueue.push([
      {
        ...makeFakeKimiConfigRow(''),
        provider: {
          ...DEFAULT_KIMI_CONFIG.provider,
          baseUrl: 'https://patched.example.com',
        },
      },
    ]);

    const { app, shareDir } = buildApp(fake);
    try {
      const patchRes = await app.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: { baseUrl: 'https://patched.example.com' } }),
      });
      expect(patchRes.status).toBe(200);
      const patchBody = (await patchRes.json()) as { provider: { baseUrl: string } };
      expect(patchBody.provider.baseUrl).toBe('https://patched.example.com');

      const insertCalls = fake.calls.filter((c) => c.op === 'insert');
      expect(insertCalls).toHaveLength(1);
      const inserted = insertCalls[0]?.values as {
        id: number;
        provider: { baseUrl: string };
      };
      expect(inserted.id).toBe(1);
      expect(inserted.provider.baseUrl).toBe('https://patched.example.com');

      const getRes = await app.request('/', { method: 'GET' });
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { provider: { baseUrl: string } };
      expect(getBody.provider.baseUrl).toBe('https://patched.example.com');
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/config/status', () => {
  it('reflects DB state when ready', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/status', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ready: boolean; authMode: string };
      expect(body.ready).toBe(true);
      expect(body.authMode).toBe('api_key');
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/config/test', () => {
  it('returns ok for configured provider', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-test')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/test', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body).toEqual({ ok: true });
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });

  it('returns missing fields when api key is empty', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/test', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('provider.apiKey');
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });

  it('surfaces auth rejection from provider', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-bad')]);

    const stubFetch = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const { app, shareDir } = buildApp(fake, stubFetch);
    try {
      const res = await app.request('/test', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('401');
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/config/sync-toml', () => {
  it('renders config.toml from the current DB row', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeFakeKimiConfigRow('sk-sync-test')]);

    const { app, shareDir } = buildApp(fake);
    try {
      const res = await app.request('/sync-toml', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      const tomlPath = path.join(shareDir, 'config.toml');
      expect(existsSync(tomlPath)).toBe(true);
      const content = readFileSync(tomlPath, 'utf8');
      expect(content).toContain('[providers."managed:kimi-code"]');
    } finally {
      rmSync(shareDir, { recursive: true, force: true });
    }
  });
});
