import path from 'node:path';
import { z } from 'zod';

// `server/src/env.ts` → project root is two levels up. Used as the dev default
// for DATA_DIR regardless of the script's cwd.
const PROJECT_ROOT = path.resolve(import.meta.dir, '../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  PGSSLROOTCERT: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // Baseline for the email allowlist gate. An admin override stored in the
  // `access_control` table takes precedence; read here as `=== 'true'`.
  ACCESS_CONTROL_ENABLED: z.enum(['true', 'false']).default('true'),

  // Test-only login backdoor. Double-guarded: the `/api/auth/test-login`
  // endpoint opens only when ENABLED === 'true' AND a non-empty TOKEN is set AND
  // the request carries the matching `x-test-login` header. Default 'false' /
  // unset keeps it fully closed in production.
  TEST_LOGIN_ENABLED: z.enum(['true', 'false']).default('false'),
  TEST_LOGIN_TOKEN: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  AZURE_AD_CLIENT_ID: z.string().min(1),
  AZURE_AD_CLIENT_SECRET: z.string().min(1),
  AZURE_AD_TENANT_ID: z.string().min(1),

  // Persistent-data paths. All three resolve to absolute paths post-parse;
  // CLAUDE_CONFIG_DIR is a sibling of WORKSPACE_ROOT, never inside it. It is the
  // ROOT for per-user agent state — the per-user `CLAUDE_CONFIG_DIR` the binary
  // sees (`<root>/<userSlug>`) is appended in `agent-paths.ts`.
  DATA_DIR: z.string().optional(),
  WORKSPACE_ROOT: z.string().optional(),
  CLAUDE_CONFIG_DIR: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),
  GIT_CLONE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
});

type ParsedEnv = z.infer<typeof envSchema>;

export type Env = ParsedEnv & {
  DATA_DIR: string;
  WORKSPACE_ROOT: string;
  CLAUDE_CONFIG_DIR: string;
};

// Build an Env from a (partial) source. Production code calls this once at
// boot via the `env` singleton below; tests call it per-test with overrides
// (e.g. `loadEnv({ MAX_UPLOAD_BYTES: '1024', WORKSPACE_ROOT: tmpDir })`) and
// inject the result into route factories.
export function loadEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  const source: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    process.stderr.write(`Invalid environment: ${JSON.stringify(parsed.error.issues, null, 2)}\n`);
    process.exit(1);
  }

  // Derive all persistent-data paths from DATA_DIR. WORKSPACE_ROOT and
  // CLAUDE_CONFIG_DIR override their default independently; both fall back to
  // siblings under DATA_DIR.
  const dataDir = path.resolve(
    parsed.data.DATA_DIR ?? (parsed.data.NODE_ENV === 'production' ? '/data' : PROJECT_ROOT),
  );
  const workspaceRoot = path.resolve(parsed.data.WORKSPACE_ROOT ?? path.join(dataDir, 'workspace'));
  const claudeConfigDir = path.resolve(
    parsed.data.CLAUDE_CONFIG_DIR ?? path.join(dataDir, 'agent-state'),
  );

  return {
    ...parsed.data,
    DATA_DIR: dataDir,
    WORKSPACE_ROOT: workspaceRoot,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };
}

export const env: Env = loadEnv();
