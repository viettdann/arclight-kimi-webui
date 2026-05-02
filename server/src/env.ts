import path from 'node:path';
import { z } from 'zod';

// `server/src/env.ts` → project root is two levels up. Used to derive a sensible
// dev default for WORKSPACE_ROOT regardless of the script's cwd.
const PROJECT_ROOT = path.resolve(import.meta.dir, '../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  PGSSLROOTCERT: z.string().optional(),
  REDIS_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  AZURE_CLIENT_ID: z.string().min(1),
  AZURE_CLIENT_SECRET: z.string().min(1),
  AZURE_TENANT_ID: z.string().min(1),

  WORKSPACE_ROOT: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),

  KIMI_SHARE_DIR: z.string().optional(),
  KIMI_CLI_NO_AUTO_UPDATE: z.string().optional(),

  KIMI_SEED_PROVIDER_TYPE: z.string().optional(),
  KIMI_SEED_PROVIDER_BASE_URL: z.string().optional(),
  KIMI_SEED_PROVIDER_API_KEY: z.string().optional(),
  KIMI_SEED_DEFAULT_MODEL: z.string().optional(),
  KIMI_SEED_MODEL_PROVIDER: z.string().optional(),
  KIMI_SEED_MODEL_NAME: z.string().optional(),
  KIMI_SEED_MODEL_MAX_CONTEXT_SIZE: z.string().optional(),
  KIMI_SEED_MODEL_CAPABILITIES: z.string().optional(),
  KIMI_SEED_MODEL_DISPLAY_NAME: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

function resolveWorkspaceRoot(value: string | undefined, nodeEnv: ParsedEnv['NODE_ENV']): string {
  if (value && value.length > 0) return path.resolve(value);
  if (nodeEnv === 'production') {
    process.stderr.write('WORKSPACE_ROOT must be set explicitly in production\n');
    process.exit(1);
  }
  return path.join(PROJECT_ROOT, 'workspace');
}

export type Env = ParsedEnv & { WORKSPACE_ROOT: string };

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
  return {
    ...parsed.data,
    WORKSPACE_ROOT: resolveWorkspaceRoot(parsed.data.WORKSPACE_ROOT, parsed.data.NODE_ENV),
  };
}

export const env: Env = loadEnv();
