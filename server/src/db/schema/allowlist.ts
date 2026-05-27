import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Emails permitted to use the app when access control is enabled. Stored
// normalized to lowercase; the email itself is the primary key.
export const allowedEmail = pgTable('allowed_email', {
  email: text('email').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Singleton (id = 1) holding the admin override for the allowlist gate.
// `enabled` is nullable: null means "follow the ACCESS_CONTROL_ENABLED env
// default". A missing row is treated identically to null.
export const accessControl = pgTable('access_control', {
  id: integer('id').primaryKey(),
  enabled: boolean('enabled'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
