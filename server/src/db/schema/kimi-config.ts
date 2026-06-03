import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const kimiConfig = pgTable(
  'kimi_config',
  {
    id: integer('id').primaryKey(),
    defaults: jsonb('defaults').notNull(),
    provider: jsonb('provider').notNull(),
    models: jsonb('models').notNull(),
    services: jsonb('services').notNull(),
    loopControl: jsonb('loop_control').notNull(),
    background: jsonb('background').notNull(),
    notifications: jsonb('notifications').notNull(),
    mcpClient: jsonb('mcp_client').notNull(),
    hooks: jsonb('hooks').notNull(),
    extraTomlOverride: text('extra_toml_override').notNull().default(''),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  () => [check('kimi_config_singleton', sql`id = 1`)],
);

export type KimiConfig = typeof kimiConfig.$inferSelect;
export type NewKimiConfig = typeof kimiConfig.$inferInsert;
