import { query } from '@anthropic-ai/claude-agent-sdk';
import { Hono } from 'hono';
import {
  type ConfigPatchRequest,
  type ConfigResponse,
  type ConfigTestRequest,
  type ConfigTestResponse,
  isClaudeProvider,
} from 'shared/types/config';
import { type AuthVariables, requireAdmin } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { logger } from '../lib/logger';
import {
  envFromProviderConfig,
  type ProviderAuthConfig,
  resolveSavedProviderConfig,
} from '../services/agent/env';
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

  // Validate provider auth. With a body, the unsaved draft is merged over the
  // saved config and probed (mode 'draft'); with no body, the saved config is
  // probed (mode 'saved'). The response reports which one ran.
  router.post('/test', async (c) => {
    let body: ConfigTestRequest = {};
    try {
      const raw = await c.req.text();
      if (raw.length > 0) body = JSON.parse(raw) as ConfigTestRequest;
    } catch {
      return c.json({ ok: false, error: 'invalid_body' } satisfies ConfigTestResponse);
    }
    if (body.provider !== undefined && !isClaudeProvider(body.provider)) {
      return c.json({ ok: false, error: 'invalid_provider' } satisfies ConfigTestResponse);
    }

    const mode: 'draft' | 'saved' = Object.keys(body).length > 0 ? 'draft' : 'saved';
    const cfg = mergeOverride(await resolveSavedProviderConfig(), body);
    const result = await testProviderAuth(cfg);
    return c.json({ ...result, mode, provider: cfg.provider } satisfies ConfigTestResponse);
  });

  return router;
}

/**
 * Merge an unsaved draft override onto the saved config. Non-secret fields
 * override whenever defined (empty string clears); secrets override only when a
 * plaintext string is sent (null/omitted keeps the saved secret).
 */
function mergeOverride(saved: ProviderAuthConfig, body: ConfigTestRequest): ProviderAuthConfig {
  const plain = (override: string | undefined, fallback: string): string =>
    override !== undefined ? override : fallback;
  const secret = (override: string | null | undefined, fallback: string): string =>
    typeof override === 'string' ? override : fallback;

  return {
    provider: isClaudeProvider(body.provider) ? body.provider : saved.provider,
    oauthToken: secret(body.CLAUDE_CODE_OAUTH_TOKEN, saved.oauthToken),
    baseUrl: plain(body.ANTHROPIC_BASE_URL, saved.baseUrl),
    authToken: secret(body.ANTHROPIC_AUTH_TOKEN, saved.authToken),
    model: plain(body.ANTHROPIC_MODEL, saved.model),
  };
}

/**
 * Required fields for the given provider that are currently empty. `api`
 * requires an auth token + model; the base URL is optional (defaults to
 * api.anthropic.com), so a missing endpoint surfaces as a probe error, not a
 * pre-flight block — mirrors the gateway's ping contract.
 */
function missingFields(cfg: ProviderAuthConfig): string[] {
  if (cfg.provider === 'api') {
    const missing: string[] = [];
    if (!cfg.authToken) missing.push('ANTHROPIC_AUTH_TOKEN');
    if (!cfg.model) missing.push('ANTHROPIC_MODEL');
    return missing;
  }
  return cfg.oauthToken ? [] : ['CLAUDE_CODE_OAUTH_TOKEN'];
}

/**
 * Validate the given provider config with a one-shot ephemeral query. Incomplete
 * config fails fast with a "Missing: …" error before any subprocess spawns, so a
 * blank config can never pass via the binary's ambient-credential fallback.
 * Bounded by an AbortController so a bad token can't hang the request.
 */
async function testProviderAuth(cfg: ProviderAuthConfig): Promise<ConfigTestResponse> {
  const missing = missingFields(cfg);
  if (missing.length > 0) return { ok: false, error: `Missing: ${missing.join(', ')}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const env = envFromProviderConfig(cfg);
    // OAuth hits real Anthropic, where the cheap haiku probe always exists. A
    // custom API endpoint may not host haiku, so probe its configured model.
    const model = cfg.provider === 'api' ? cfg.model : TEST_MODEL;

    const stream = query({
      prompt: 'Reply with OK.',
      options: {
        model,
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
