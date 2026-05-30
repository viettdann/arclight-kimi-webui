import { query } from '@anthropic-ai/claude-agent-sdk';
import { Hono } from 'hono';
import type { ConfigPatchRequest, ConfigResponse, ConfigTestResponse } from 'shared/types/config';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { logger } from '../lib/logger';
import { buildAgentEnv, getClaudeCodePath } from '../services/agent/env';
import { getAllSettings, updateSettings } from '../services/config';
import { clearSlashCommandsCache } from '../services/slash-commands-cache';

export interface ConfigRouterDeps {
  db: DB;
}

// Model used for the auth probe — cheapest available, output is discarded.
const TEST_MODEL = 'claude-haiku-4-5-20251001';
const TEST_TIMEOUT_MS = 30_000;

export function createConfigRouter(deps: ConfigRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db } = deps;
  void db; // reserved for future per-request scoping; settings use the singleton
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAdmin);

  router.get('/', async (c) => {
    const body: ConfigResponse = { settings: await getAllSettings() };
    return c.json(body);
  });

  router.patch('/', async (c) => {
    const body = (await c.req.json()) as ConfigPatchRequest;
    await updateSettings(body.settings ?? []);
    // A provider/model/settings change can alter the slash-command list, so
    // drop the per-workDir cache to avoid serving a stale picker.
    clearSlashCommandsCache();
    const res: ConfigResponse = { settings: await getAllSettings() };
    return c.json(res);
  });

  router.post('/test', async (c) => {
    const result = await testProviderAuth();
    return c.json(result);
  });

  return router;
}

/**
 * Validate the configured provider auth with a one-shot ephemeral query.
 * Bounded by an AbortController so a bad token can't hang the request.
 */
async function testProviderAuth(): Promise<ConfigTestResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const env = await buildAgentEnv();
    const pathToClaudeCodeExecutable = await getClaudeCodePath();

    const stream = query({
      prompt: 'Reply with OK.',
      options: {
        model: TEST_MODEL,
        pathToClaudeCodeExecutable,
        env,
        permissionMode: 'dontAsk',
        allowedTools: [],
        disallowedTools: ['*'],
        settingSources: [],
        persistSession: false,
        abortController: controller,
      },
    });

    for await (const message of stream) {
      if (message.type === 'result') {
        if (message.subtype === 'success') return { ok: true };
        return { ok: false, error: message.subtype };
      }
    }

    return { ok: false, error: 'no result message received' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ error }, 'config: provider auth test failed');
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

export default createConfigRouter({ db: defaultDb });
