import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  anthropicAuthVariants,
  LIGHT_MODEL,
  OAUTH_BETA,
  OAUTH_MODELS,
  type ProviderTestResponse,
  type ProviderType,
} from 'shared/types/providers';
import { logger } from '../../lib/logger';
import { ephemeralPaths } from '../agent/agent-paths';
import { buildAgentEnv } from '../agent/env';

const FETCH_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 30_000;

type ModelEntry = { id: string; displayName: string | null; contextWindow: number | null };

export async function fetchModels(draft: {
  type: ProviderType;
  baseUrl?: string | null;
  token: string;
}): Promise<ModelEntry[]> {
  try {
    // oauth always targets Anthropic directly; only `api` honors a custom base url.
    const base =
      draft.type === 'api'
        ? (draft.baseUrl ?? 'https://api.anthropic.com')
        : 'https://api.anthropic.com';
    const url = `${base}/v1/models?limit=1000`;

    const headerVariants =
      draft.type === 'oauth'
        ? anthropicAuthVariants(draft.token, OAUTH_BETA)
        : anthropicAuthVariants(draft.token);

    for (const headers of headerVariants) {
      let res: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          res = await fetch(url, { headers, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        continue;
      }

      if (!res.ok) continue;

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        continue;
      }

      if (
        typeof body !== 'object' ||
        body === null ||
        !Array.isArray((body as Record<string, unknown>).data)
      ) {
        continue;
      }

      const data = (body as { data: unknown[] }).data;
      const models: ModelEntry[] = [];
      for (const entry of data) {
        if (typeof entry !== 'object' || entry === null) continue;
        const e = entry as Record<string, unknown>;
        if (typeof e.id !== 'string') continue;
        // Drop decommissioned models (e.g. ARK marks them `status: "Shutdown"`).
        if (e.status === 'Shutdown') continue;

        const tokenLimits = e.token_limits as Record<string, unknown> | undefined;
        const contextWindow =
          typeof e.max_input_tokens === 'number' && e.max_input_tokens > 0
            ? e.max_input_tokens
            : typeof e.context_length === 'number' && e.context_length > 0
              ? e.context_length
              : typeof tokenLimits?.context_window === 'number' && tokenLimits.context_window > 0
                ? tokenLimits.context_window
                : null;

        // Anthropic uses `display_name`; OpenAI-compatible listings (e.g. ARK)
        // put the human label in `name`.
        const displayName =
          typeof e.display_name === 'string'
            ? e.display_name
            : typeof e.name === 'string'
              ? e.name
              : null;

        models.push({ id: e.id, displayName, contextWindow });
      }
      // Surface models with a known context window first; keep the rest (image,
      // video, embedding, or metadata-less entries) below so nothing is lost.
      // Sort is stable, so original order is preserved within each group.
      models.sort((a, b) => {
        const aKnown = a.contextWindow !== null ? 0 : 1;
        const bKnown = b.contextWindow !== null ? 0 : 1;
        return aKnown - bKnown;
      });
      return models;
    }

    return [];
  } catch (err) {
    logger.warn({ err }, 'providers/test: fetchModels failed');
    return [];
  }
}

export async function pingProvider(
  draft: { type: ProviderType; baseUrl?: string | null; token: string },
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const env = buildAgentEnv(
      {
        type: draft.type,
        baseUrl: draft.baseUrl ?? null,
        token: draft.token,
      },
      ephemeralPaths(),
    );

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
    logger.warn({ error }, 'providers/test: pingProvider failed');
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

export async function testProvider(draft: {
  type: ProviderType;
  baseUrl?: string | null;
  token: string;
  model?: string | null;
}): Promise<ProviderTestResponse> {
  if (draft.type === 'api') {
    const fetched = await fetchModels(draft);
    const pingModel = draft.model || fetched[0]?.id;
    if (!pingModel) return { ok: false, error: 'no model' };
    const r = await pingProvider(draft, pingModel);
    return { ok: r.ok, error: r.error, availableModels: fetched };
  }

  // oauth
  const r = await pingProvider(draft, LIGHT_MODEL);
  return {
    ok: r.ok,
    error: r.error,
    availableModels: OAUTH_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
    })),
  };
}
