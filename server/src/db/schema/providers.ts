import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

// One credential/endpoint owning N models. `ownerUserId` NULL = Built-in
// (admin-managed, API-only, carries a visibility flag); non-null = Personal
// (per-user, oauth or api, no visibility). The `token` column is plaintext
// at-rest, mirroring `git_credentials`; it is masked when serialized.
export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL → Built-in. ON DELETE CASCADE so a user's Personal providers are
    // removed with the user.
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    // `'oauth' | 'api'` — validated at the route layer.
    type: varchar('type', { length: 16 }).notNull(),
    // `'public' | 'private'` — set only when ownerUserId IS NULL; null for Personal.
    visibility: varchar('visibility', { length: 16 }),
    namespace: varchar('namespace', { length: 100 }).notNull(),
    // Only meaningful for `api`; null for `oauth`.
    baseUrl: text('base_url'),
    // Secret: oauth token or api auth token. Save is gated by a passing test.
    token: text('token').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    index('providers_owner_idx').on(t.ownerUserId),
    // `type` is constrained to the two recognized credential kinds.
    check('providers_type_check', sql`type IN ('oauth', 'api')`),
    // `visibility`, when set, must be one of the two scopes.
    check(
      'providers_visibility_check',
      sql`visibility IS NULL OR visibility IN ('public', 'private')`,
    ),
    // `visibility` is present exactly for Built-in providers (owner_user_id IS NULL).
    check(
      'providers_visibility_scope_check',
      sql`(owner_user_id IS NULL) = (visibility IS NOT NULL)`,
    ),
  ],
);

// Models exposed by a provider. `modelId` is the exact wire value sent to the
// endpoint; `displayName` is the composer tag's right side (falls back to modelId).
export const providerModels = pgTable(
  'provider_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    modelId: varchar('model_id', { length: 120 }).notNull(),
    displayName: varchar('display_name', { length: 120 }),
    contextWindow: integer('context_window'),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [
    index('provider_models_provider_idx').on(t.providerId),
    // A provider exposes each wire model id at most once.
    unique('provider_models_provider_model_unique').on(t.providerId, t.modelId),
  ],
);

export type ProviderRow = typeof providers.$inferSelect;
export type NewProviderRow = typeof providers.$inferInsert;
export type ProviderModelRow = typeof providerModels.$inferSelect;
export type NewProviderModelRow = typeof providerModels.$inferInsert;
