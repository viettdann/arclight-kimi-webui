import {
  boolean,
  customType,
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

// Postgres `bytea` <-> JS bytes. postgres.js returns bytea as a Node Buffer;
// we surface it as a plain Uint8Array so the rest of the pipeline stays
// runtime-agnostic and binary-safe.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

// One row = one personal skill, stored as a single cleaned, normalized zip
// archive (`archive`). `enabled = false` blocks materialization without
// deleting the row. Re-uploading a `(owner, name)` replaces the archive and
// preserves `enabled`.
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Personal-only: every skill is owned. Removed with the user.
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Canonical skill name (frontmatter `name`, validated `^[a-z0-9]+(-[a-z0-9]+)*$`).
    name: varchar('name', { length: 64 }).notNull(),
    description: text('description').notNull().default(''),
    // false → row kept, dir pruned from the config dir on the next turn.
    enabled: boolean('enabled').notNull().default(true),
    // Entry count and uncompressed byte total of the archive (for display).
    fileCount: integer('file_count').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Cleaned, normalized zip blob. Never serialized to the client.
    archive: bytea('archive').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    // A user owns each skill name at most once; re-upload replaces by name.
    unique('skills_owner_name_unique').on(t.ownerUserId, t.name),
    index('skills_owner_idx').on(t.ownerUserId),
  ],
);

export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;
