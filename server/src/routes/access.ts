import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AccessControlResponse, AllowedEmailDTO, AllowlistResponse } from 'shared/types';
import { normalizeEmail, resolveAccessControl } from '../auth/access';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import type { DB } from '../db';
import { accessControl, allowedEmail } from '../db/schema';
import { env } from '../env';

export interface AccessRouterDeps {
  db: DB;
}

// Pragmatic single-address check; SSO already vouches for the address, this
// only guards against obvious typos in the admin input.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toAllowedEmailDTO = (row: { email: string; createdAt: Date }): AllowedEmailDTO => ({
  email: row.email,
  createdAt: row.createdAt.toISOString(),
});

export function createAccessRouter(deps: AccessRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  router.get('/allowlist', async (c) => {
    const rows = await db
      .select({ email: allowedEmail.email, createdAt: allowedEmail.createdAt })
      .from(allowedEmail)
      .orderBy(desc(allowedEmail.createdAt));
    const body: AllowlistResponse = { emails: rows.map(toAllowedEmailDTO) };
    return c.json(body);
  });

  router.post('/allowlist', async (c) => {
    const { email } = (await c.req.json()) as { email?: unknown };
    const normalized = typeof email === 'string' ? normalizeEmail(email) : '';
    if (!EMAIL_RE.test(normalized)) {
      return c.json({ error: 'invalid_email' }, 400);
    }
    await db.insert(allowedEmail).values({ email: normalized }).onConflictDoNothing();
    const [row] = await db
      .select({ email: allowedEmail.email, createdAt: allowedEmail.createdAt })
      .from(allowedEmail)
      .where(eq(allowedEmail.email, normalized))
      .limit(1);
    const dto: AllowedEmailDTO = toAllowedEmailDTO(
      row ?? { email: normalized, createdAt: new Date() },
    );
    return c.json(dto);
  });

  router.delete('/allowlist/:email', async (c) => {
    await db
      .delete(allowedEmail)
      .where(eq(allowedEmail.email, normalizeEmail(c.req.param('email'))));
    return c.json({ ok: true });
  });

  router.get('/control', async (c) => {
    const { override, envDefault, effective } = await resolveAccessControl(db);
    const body: AccessControlResponse = { override, envDefault, effective };
    return c.json(body);
  });

  router.patch('/control', async (c) => {
    const { override } = (await c.req.json()) as { override?: unknown };
    if (override !== null && typeof override !== 'boolean') {
      return c.json({ error: 'invalid_override' }, 400);
    }
    await db
      .insert(accessControl)
      .values({ id: 1, enabled: override, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: accessControl.id,
        set: { enabled: override, updatedAt: new Date() },
      });
    // The effective state is fully known from the value just written.
    const envDefault = env.ACCESS_CONTROL_ENABLED === 'true';
    const body: AccessControlResponse = { override, envDefault, effective: override ?? envDefault };
    return c.json(body);
  });

  return router;
}
