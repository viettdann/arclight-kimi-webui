import { index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { gitCredentials } from './git-credentials';

export const projectGitMetadata = pgTable(
  'project_git_metadata',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectName: varchar('project_name', { length: 255 }).notNull(),
    remoteUrl: text('remote_url'),
    provider: varchar('provider', { length: 32 }),
    defaultBranch: varchar('default_branch', { length: 255 }),
    credentialId: uuid('credential_id').references(() => gitCredentials.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('project_git_metadata_user_idx').on(t.userId),
  ],
);

export type ProjectGitMetadataRow = typeof projectGitMetadata.$inferSelect;
