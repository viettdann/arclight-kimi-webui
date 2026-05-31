import { query } from '@anthropic-ai/claude-agent-sdk';
import { anthropicAuthVariants } from 'shared/types/providers';
import { logger } from '../../lib/logger';
import { buildAgentEnv } from './env';

const log = logger.child({ module: 'agent/title' });

/** Cap the prompt input so a huge first message can't blow up the request. */
const MAX_INPUT_CHARS = 500;

/** Cap the cleaned title length; longer titles are rejected. */
const MAX_TITLE_CHARS = 80;

/** Abort title generation if the model hasn't finished within this window. */
const TITLE_TIMEOUT_MS = 30_000;

/** A title is a handful of words; never let the model run long. */
const MAX_OUTPUT_TOKENS = 64;

const TITLE_PROMPT = `Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session. The title should be clear enough that the user recognizes the session in a list. Use sentence case: capitalize only the first word and proper nouns.

Respond with ONLY the title text, nothing else. No quotes, no JSON, no explanation.

Good examples:
- Fix login button on mobile
- Add OAuth authentication
- Debug failing CI tests
- Refactor API client error handling

Bad (too vague): Code changes
Bad (too long): Investigate and fix the issue where the login button does not respond on mobile devices`;

function cleanTitle(raw: string): string | null {
  const title = raw
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/^-\s*/, '')
    .trim();
  if (!title) return null;
  return title.length <= MAX_TITLE_CHARS ? title : null;
}

/** Provider fields needed to issue a title request. A ProviderRow is assignable. */
interface TitleProvider {
  type: string;
  baseUrl: string | null;
  token: string;
}

/** Pull the concatenated text out of an Anthropic Messages API response body. */
function extractMessageText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  let text = '';
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      text += (block as { text: string }).text;
    }
  }
  return text.trim() || null;
}

/**
 * Title an `api` provider with a single raw Messages API call — the instruction
 * rides in `system`, keeping the request tiny (~60 input tokens) versus a
 * full `query()` turn. A custom api token may be an Anthropic key (`x-api-key`)
 * or a proxy Bearer token, so both auth headers are tried in turn.
 */
async function titleViaMessages(
  provider: TitleProvider,
  model: string,
  userText: string,
  signal: AbortSignal,
): Promise<string | null> {
  const base = provider.baseUrl ?? 'https://api.anthropic.com';

  for (const auth of anthropicAuthVariants(provider.token)) {
    let res: Response;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: TITLE_PROMPT,
          messages: [{ role: 'user', content: userText }],
        }),
        signal,
      });
    } catch {
      // Network error or abort (timeout) — nothing more to try.
      return null;
    }

    // Wrong auth header → try the other one; any other failure is terminal.
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) return null;

    try {
      return extractMessageText(await res.json());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Title an `oauth` provider through the SDK. OAuth tokens are Anthropic-native
 * and bound to Claude Code's auth surface (beta header + identity system
 * prompt), which `query()` supplies; the light model keeps it fast and cheap.
 */
async function titleViaAgent(
  provider: TitleProvider,
  model: string,
  userText: string,
  abortController: AbortController,
): Promise<string | null> {
  const env = buildAgentEnv(provider);
  const q = query({
    prompt: `${TITLE_PROMPT}\n---\n${userText}`,
    options: {
      model,
      env,
      abortController,
      permissionMode: 'dontAsk',
      allowedTools: [],
      disallowedTools: ['*'],
      settingSources: [],
      persistSession: false,
    },
  });

  let result: string | null = null;
  for await (const m of q) {
    if (m.type === 'result' && m.subtype === 'success') {
      result = m.result.trim();
    }
  }
  return result;
}

/**
 * Generate a short AI title from a session's first user message. Runs
 * ephemerally — no transcript is written and no tools are available. `api`
 * providers take a raw Messages API call; `oauth` providers go through the SDK.
 * The caller selects a provider-compatible `model` id (a custom api proxy may
 * not expose the Anthropic light model). Returns the cleaned title, or `null`
 * if generation fails, times out, or yields an empty/invalid title. The caller
 * persists the title; this never touches the SDK's session store.
 */
export async function generateTitle(
  firstUserMessage: string,
  provider: TitleProvider,
  model: string,
): Promise<string | null> {
  const userText =
    firstUserMessage.length > MAX_INPUT_CHARS
      ? `${firstUserMessage.slice(0, MAX_INPUT_CHARS)}…`
      : firstUserMessage;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TITLE_TIMEOUT_MS);

  try {
    const raw =
      provider.type === 'api'
        ? await titleViaMessages(provider, model, userText, abortController.signal)
        : await titleViaAgent(provider, model, userText, abortController);

    const title = raw ? cleanTitle(raw) : null;
    if (!title) {
      log.warn('generated title invalid — skipping');
      return null;
    }
    log.info({ title }, 'AI title generated');
    return title;
  } catch (err) {
    log.warn({ err }, 'title generation failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
