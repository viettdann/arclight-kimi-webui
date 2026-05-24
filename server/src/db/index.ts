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
  let certPath = resolve(process.cwd(), env.PGSSLROOTCERT);
  if (!existsSync(certPath)) {
    // If running from root, env.PGSSLROOTCERT might be "../certs/ca.crt" but we are already in the root, so it should be "./certs/ca.crt"
    const rootPath = resolve(process.cwd(), env.PGSSLROOTCERT.replace(/^\.\.\//, ''));
    if (existsSync(rootPath)) {
      certPath = rootPath;
    } else {
      const serverCwdPath = resolve(process.cwd(), 'server', env.PGSSLROOTCERT);
      if (existsSync(serverCwdPath)) {
        certPath = serverCwdPath;
      } else {
        const dirnamePath = resolve(__dirname, '../../..', env.PGSSLROOTCERT.replace(/^\.\.\//, ''));
        if (existsSync(dirnamePath)) {
          certPath = dirnamePath;
        } else {
          throw new Error(`PGSSLROOTCERT does not exist at ${certPath}`);
        }
      }
    }
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
