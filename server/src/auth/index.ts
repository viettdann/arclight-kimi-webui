import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';

export function slug(email: string): string {
  return (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

// Advisory-lock key for serialising first-admin election across concurrent
// sign-ups. Value is arbitrary; only consistency between callers matters.
const FIRST_ADMIN_LOCK_KEY = 0x4b_49_4d_49; // 'KIMI'

export const auth = betterAuth({
  appName: 'kimi-webui',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  emailAndPassword: { enabled: false },

  socialProviders: {
    microsoft: {
      clientId: env.AZURE_AD_CLIENT_ID,
      clientSecret: env.AZURE_AD_CLIENT_SECRET,
      tenantId: env.AZURE_AD_TENANT_ID,
      prompt: 'select_account',
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['microsoft'],
    },
  },

  user: {
    additionalFields: {
      role: {
        type: ['admin', 'user'],
        defaultValue: 'user',
        input: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const [row] = await db.select({ n: count() }).from(schema.user);
          const role = (row?.n ?? 0) === 0 ? 'admin' : 'user';
          return { data: { ...user, role } };
        },
        after: async (user) => {
          const dir = path.join(env.WORKSPACE_ROOT, slug(user.email));
          await mkdir(dir, { recursive: true, mode: 0o700 });

          // Race repair: the before-hook count() can return 0 for two concurrent
          // sign-ups, electing both as admin. After insert, take an advisory lock
          // and demote any extra admins, keeping only the oldest by createdAt.
          const role = (user as { role?: string }).role;
          if (role !== 'admin') return;
          await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${FIRST_ADMIN_LOCK_KEY}::bigint)`);
            const admins = await tx
              .select({ id: schema.user.id })
              .from(schema.user)
              .where(eq(schema.user.role, 'admin'))
              .orderBy(asc(schema.user.createdAt));
            if (admins.length <= 1) return;
            const demoteIds = admins.slice(1).map((a) => a.id);
            await tx
              .update(schema.user)
              .set({ role: 'user' })
              .where(inArray(schema.user.id, demoteIds));
          });
        },
      },
    },
  },

  advanced: { cookiePrefix: 'kimi-webui' },
});

export type Auth = typeof auth;
export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;
