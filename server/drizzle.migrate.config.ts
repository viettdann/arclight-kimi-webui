import { defineConfig } from 'drizzle-kit';

// Migrate-only config for the container `migrator` role. Imports no schema and
// parses no .env file — `drizzle-kit migrate` only needs the compiled SQL in
// `out` plus a DB connection. SSL is off: production Postgres is co-located in
// the same compose network.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Parse the URL into components. Passing `url` makes drizzle-kit's pg driver
// re-parse `sslmode` from the string and override the explicit `ssl` option
// (drizzle-orm#831).
const parsed = new URL(process.env.DATABASE_URL);

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  dbCredentials: {
    host: parsed.hostname,
    port: Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    ssl: false,
  },
});
