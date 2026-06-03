import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth';

// Per-user git credentials (PAT over HTTPS). Multiple rows per user. The `token`
// column is plaintext at-rest, mirroring the `kimi_config.provider.apiKey`
// precedent; it is masked when serialized to the client.
export const gitCredentials = pgTable(
  'git_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 100 }).notNull(),
    // `'github' | 'azure_devops'` — validated by zod at the route layer.
    provider: varchar('provider', { length: 32 }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [index('git_credentials_user_idx').on(t.userId)],
);

export type GitCredentialRow = typeof gitCredentials.$inferSelect;
