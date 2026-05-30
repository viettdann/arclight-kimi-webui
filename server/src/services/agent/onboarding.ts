import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../env';
import { logger } from '../../lib/logger';

/**
 * The `claude` binary reads its top-level config from
 * `$CLAUDE_CONFIG_DIR/.claude.json`. On a fresh deploy that file is absent, so a
 * non-interactive run blocks on the onboarding/login prompt and never starts.
 *
 * Auth itself is supplied via env vars (see buildAgentEnv); onboarding is a
 * separate first-run gate. Ensure `hasCompletedOnboarding: true` is present so
 * headless runs proceed. Existing state written by the binary (userID, project
 * trust, migration flags) is preserved — we merge, never clobber. Idempotent:
 * once the flag is already set, this is a no-op.
 */
export async function ensureClaudeOnboarding(
  configDir: string = env.CLAUDE_CONFIG_DIR,
): Promise<void> {
  const file = join(configDir, '.claude.json');

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    if (config.hasCompletedOnboarding === true) return; // already bootstrapped
  } catch {
    // Missing or unparseable → fall through and write a minimal valid file.
    config = {};
  }

  config.hasCompletedOnboarding = true;
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  logger.info({ file }, 'claude onboarding bootstrapped (hasCompletedOnboarding=true)');
}
