import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSessionStore,
  type SqlExecutor,
} from '../src/services/agent/session-store';
import type { SessionStore } from '@anthropic-ai/claude-agent-sdk';

/** Absolute path to `server/src/db/migrations`, resolved from this test file. */
function migrationsFolder(): string {
  const here = typeof import.meta.dir === 'string' ? import.meta.dir : dirname(fileURLToPath(import.meta.url));
  // server/test → server/src/db/migrations
  return join(here, '..', 'src', 'db', 'migrations');
}

type PgDb = ReturnType<typeof drizzle> & SqlExecutor;

export interface PgHandle {
  db: PgDb;
  pglite: PGlite;
  close: () => Promise<void>;
}

/**
 * Apply ONLY the `session_store_entries` table + its 3 indexes by executing the
 * DDL from `0004_add_session_store_entries.sql` statement-by-statement. The
 * fallback for when the full migrations folder includes a non-store migration
 * pglite cannot run.
 */
async function applyStoreTableDdl(db: PgDb): Promise<void> {
  const ddlPath = join(migrationsFolder(), '0004_add_session_store_entries.sql');
  const text = await Bun.file(ddlPath).text();
  const statements = text
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

/**
 * Spin a REAL Postgres engine in-process (pglite, in-memory) for store tests.
 * Prefers running the Drizzle migrations folder; if that errors on a
 * non-store migration, falls back to creating just the `session_store_entries`
 * table + indexes from the 0004 DDL.
 */
export async function makePgDb(): Promise<PgHandle> {
  const pglite = new PGlite();
  const db = drizzle(pglite) as PgDb;

  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } catch {
    // Some non-store migration is incompatible with pglite — create just the
    // table under test from its own DDL.
    await applyStoreTableDdl(db);
  }

  return {
    db,
    pglite,
    close: async () => {
      await pglite.close();
    },
  };
}

/**
 * Build an async factory that yields an isolated, empty {@link SessionStore}
 * for each conformance test, all sharing one pglite. Each call TRUNCATEs the
 * table (RESTART IDENTITY to keep `id` deterministic) before returning a store.
 */
export function makeConformanceFactory(db: PgDb): () => Promise<SessionStore> {
  return async () => {
    await db.execute(sql`TRUNCATE session_store_entries RESTART IDENTITY`);
    return createSessionStore(db);
  };
}
