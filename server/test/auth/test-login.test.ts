import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Hono } from 'hono';
import { buildAuth } from '../../src/auth/index';
import { createTestLoginRouter } from '../../src/auth/test-login';
import { allowedEmail } from '../../src/db/schema';
import { loadEnv } from '../../src/env';
import { migrationsFolder } from '../_helpers-pg';

// Real Postgres (pglite, in-process) so BetterAuth's signUpEmail/signInEmail
// run against actual user/session/account rows. The test-login backdoor mints
// a real session, so an in-memory fake would not exercise the cookie path.

const TOKEN = 'test-login-token-fixed';

// Drop a Set-Cookie attribute string down to the bare `name=value` pair that a
// subsequent request would echo back in its Cookie header.
function cookieHeader(setCookie: string | null): string {
  return (setCookie ?? '').split(';')[0] ?? '';
}

type Harness = {
  app: Hono;
  auth: ReturnType<typeof buildAuth>;
  db: ReturnType<typeof drizzle>;
  pglite: PGlite;
};

async function makeHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const pglite = new PGlite();
  const db = drizzle(pglite);
  await migrate(db as never, { migrationsFolder: migrationsFolder() });

  const env = loadEnv({
    TEST_LOGIN_ENABLED: 'true',
    TEST_LOGIN_TOKEN: TOKEN,
    WORKSPACE_ROOT: '/tmp/mtc-webui-test',
    ...overrides,
  });
  const auth = buildAuth(db as never, env);
  const app = new Hono();
  app.route('/api/auth/test-login', createTestLoginRouter({ db: db as never, env, auth }));
  return { app, auth, db, pglite };
}

async function post(app: Hono, opts: { token?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token !== undefined) headers['x-test-login'] = opts.token;
  return app.request('/api/auth/test-login', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe('test-login backdoor', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness();
  });
  afterAll(async () => {
    await h.pglite.close();
  });

  describe('double guard', () => {
    it('returns 404 when the token header is missing', async () => {
      const res = await post(h.app, { body: {} });
      expect(res.status).toBe(404);
    });

    it('returns 404 when the token header is wrong', async () => {
      const res = await post(h.app, { token: 'nope', body: {} });
      expect(res.status).toBe(404);
    });

    it('returns 404 when TEST_LOGIN_ENABLED is false even with the right token', async () => {
      const off = await makeHarness({ TEST_LOGIN_ENABLED: 'false' });
      const res = await post(off.app, { token: TOKEN, body: {} });
      expect(res.status).toBe(404);
      await off.pglite.close();
    });

    it('returns 404 when TEST_LOGIN_TOKEN is empty', async () => {
      const noToken = await makeHarness({ TEST_LOGIN_TOKEN: '' });
      // An empty configured token must never match an empty header.
      const res = await post(noToken.app, { token: '', body: {} });
      expect(res.status).toBe(404);
      await noToken.pglite.close();
    });
  });

  describe('session minting', () => {
    it('mints an admin session whose cookie validates via getSession', async () => {
      const res = await post(h.app, {
        token: TOKEN,
        body: { email: 'admin@example.test', role: 'admin' },
      });
      expect(res.status).toBe(200);

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();

      const json = (await res.json()) as { user: { email: string; role: string } };
      expect(json.user.email).toBe('admin@example.test');
      expect(json.user.role).toBe('admin');

      const session = await h.auth.api.getSession({
        headers: new Headers({ cookie: cookieHeader(setCookie) }),
      });
      expect(session?.user.email).toBe('admin@example.test');
      expect((session?.user as { role?: string }).role).toBe('admin');
    });

    it('defaults to role user and email test@example.test', async () => {
      const res = await post(h.app, { token: TOKEN, body: {} });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { user: { email: string; role: string } };
      expect(json.user.email).toBe('test@example.test');
      expect(json.user.role).toBe('user');
    });

    it('inserts a user-role email into the allowlist (idempotent)', async () => {
      await post(h.app, { token: TOKEN, body: { email: 'allowed@example.test', role: 'user' } });
      // Calling again must not throw on the email primary key.
      await post(h.app, { token: TOKEN, body: { email: 'allowed@example.test', role: 'user' } });

      const rows = await h.db
        .select({ email: allowedEmail.email })
        .from(allowedEmail)
        .where(eq(allowedEmail.email, 'allowed@example.test'));
      expect(rows.length).toBe(1);
    });

    it('does not allowlist an admin-role email', async () => {
      await post(h.app, { token: TOKEN, body: { email: 'adminonly@example.test', role: 'admin' } });
      const rows = await h.db
        .select({ email: allowedEmail.email })
        .from(allowedEmail)
        .where(eq(allowedEmail.email, 'adminonly@example.test'));
      expect(rows.length).toBe(0);
    });

    it('is idempotent and lets the role be changed on a repeat call', async () => {
      const first = await post(h.app, {
        token: TOKEN,
        body: { email: 'switch@example.test', role: 'user' },
      });
      expect(first.status).toBe(200);

      const second = await post(h.app, {
        token: TOKEN,
        body: { email: 'switch@example.test', role: 'admin' },
      });
      expect(second.status).toBe(200);
      const json = (await second.json()) as { user: { role: string } };
      expect(json.user.role).toBe('admin');
    });
  });
});
