import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ../.env explicitly so drizzle-kit (which spawns its own process and
// does not honor `bun --env-file`) sees DATABASE_URL + PGSSLROOTCERT.
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf-8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL not set; check ../.env or environment');
}

const sslCertEnv = process.env.PGSSLROOTCERT;
const sslCertPath = sslCertEnv ? resolve(__dirname, sslCertEnv) : null;
const sslCa = sslCertPath && existsSync(sslCertPath) ? readFileSync(sslCertPath, 'utf-8') : null;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*',
  out: './src/db/migrations',
  dbCredentials: {
    url: databaseUrl,
    ssl: sslCa ? { ca: sslCa, rejectUnauthorized: true } : 'require',
  },
  verbose: true,
  strict: true,
});
