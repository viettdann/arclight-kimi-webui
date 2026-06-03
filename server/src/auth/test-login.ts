import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { DB } from '../db';
import { schema } from '../db';
import { allowedEmail } from '../db/schema';
import type { Env } from '../env';
import { normalizeEmail } from './access';
import { type Auth, auth as defaultAuth } from './index';

// Fixed credential the backdoor signs the test user in with. Must be ≥ 8 chars
// (BetterAuth's default minPasswordLength). Never a real user secret — the
// account only exists when TEST_LOGIN_ENABLED is on.
const TEST_PASSWORD = 'test-login-password';

const DEFAULT_EMAIL = 'test@example.test';
const DEFAULT_NAME = 'Test User';

interface TestLoginBody {
  email?: string;
  role?: 'admin' | 'user';
  name?: string;
}

export interface TestLoginDeps {
  db: DB;
  env: Env;
  /** Injectable for tests; defaults to the production `auth` singleton. */
  auth?: Auth;
}

/**
 * Test-only login backdoor: `POST /api/auth/test-login`.
 *
 * Double-guarded — opens only when `TEST_LOGIN_ENABLED === 'true'` AND
 * `TEST_LOGIN_TOKEN` is non-empty AND the request carries the matching
 * `x-test-login` header. Any guard failing returns 404 so the endpoint looks
 * absent. The router itself attaches no `requireAuth`/`requireAllowed`; the
 * token guard is the only gate.
 *
 * On success it provisions (or reuses) a real `user` + `session` row via
 * BetterAuth and forwards BetterAuth's `Set-Cookie` verbatim, so the resulting
 * session passes both REST `sessionMiddleware` and the WS heartbeat's
 * `validateAuthSession` exactly like a real Microsoft login.
 */
export function createTestLoginRouter(deps: TestLoginDeps): Hono {
  const { db, env } = deps;
  const auth = deps.auth ?? defaultAuth;
  const app = new Hono();

  app.post('/', async (c) => {
    // ─── Double guard ───────────────────────────────────────────────────────
    const token = env.TEST_LOGIN_TOKEN;
    if (
      env.TEST_LOGIN_ENABLED !== 'true' ||
      token == null ||
      token === '' ||
      c.req.header('x-test-login') !== token
    ) {
      return c.json({ error: 'not_found' }, 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as TestLoginBody;
    const email = normalizeEmail(body.email ?? DEFAULT_EMAIL);
    const role = body.role === 'admin' ? 'admin' : 'user';
    const name = body.name ?? DEFAULT_NAME;

    // ─── Ensure the user exists ──────────────────────────────────────────────
    // signUpEmail handles hashing + the account row + the user.create hook
    // (which provisions the workspace dir). On a repeat call it throws a
    // "user already exists" APIError — the idempotent path. Any other APIError
    // (weak password, invalid email, …) is a real failure and rethrows, so it
    // surfaces instead of silently producing a broken sign-in below.
    try {
      await auth.api.signUpEmail({ body: { email, password: TEST_PASSWORD, name } });
    } catch (err) {
      const code = err instanceof APIError ? (err.body as { code?: string })?.code : undefined;
      if (code !== 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') throw err;
    }

    // Force the requested role directly, outside the first-admin election in
    // the create hook, so the test — not insertion order — decides the role.
    await db.update(schema.user).set({ role }).where(eq(schema.user.email, email));

    // When the allowlist gate is on, a `role: 'user'` account would land on
    // Coming Soon. Insert the email so the allowed path is testable too;
    // idempotent via the email primary key. Admins bypass the gate anyway.
    if (role === 'user') {
      await db.insert(allowedEmail).values({ email }).onConflictDoNothing();
    }

    // ─── Mint the session and forward the cookie ─────────────────────────────
    // asResponse: true returns a Response with a real, properly-signed
    // Set-Cookie; returning it directly lets Hono forward the header + body
    // ({ token, user }) unchanged. No hand-rolled cookie.
    return auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
      asResponse: true,
    });
  });

  return app;
}
