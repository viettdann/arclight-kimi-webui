import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

type PostgresSSL = NonNullable<postgres.Options<Record<string, never>>['ssl']>;

// PGSSLROOTCERT is relative to the server CWD per design doc (e.g. ../certs/ca.crt).
function buildSslOption(): PostgresSSL {
  if (!env.PGSSLROOTCERT) return 'require';
  const certPath = resolve(process.cwd(), env.PGSSLROOTCERT);
  if (!existsSync(certPath)) {
    throw new Error(`PGSSLROOTCERT does not exist at ${certPath}`);
  }
  return {
    ca: readFileSync(certPath, 'utf-8'),
    rejectUnauthorized: true,
  };
}

const client = postgres(env.DATABASE_URL, {
  ssl: buildSslOption(),
  max: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });
export { client, schema };
export type DB = typeof db;
