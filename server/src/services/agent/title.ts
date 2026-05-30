import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../lib/logger';
import { buildAgentEnv } from './env';

const log = logger.child({ module: 'agent/title' });

/** Model used for cheap, fast title generation. */
const TITLE_MODEL = 'claude-haiku-4-5-20251001';

/** Cap the prompt input so a huge first message can't blow up the request. */
const MAX_INPUT_CHARS = 500;

/** Cap the cleaned title length; longer titles are rejected. */
const MAX_TITLE_CHARS = 80;

/** Abort title generation if the model hasn't finished within this window. */
const TITLE_TIMEOUT_MS = 15_000;

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

/**
 * Generate a short AI title from a session's first user message using a cheap
 * Haiku model. Runs ephemerally — no transcript is written and no tools are
 * available. Returns the cleaned title, or `null` if generation fails, times
 * out, or yields an empty/invalid title. The caller persists the title; this
 * never touches the SDK's session store.
 */
export async function generateTitle(firstUserMessage: string): Promise<string | null> {
  const env = await buildAgentEnv();

  const description =
    firstUserMessage.length > MAX_INPUT_CHARS
      ? `${firstUserMessage.slice(0, MAX_INPUT_CHARS)}…`
      : firstUserMessage;
  const prompt = `${TITLE_PROMPT}\n---\n${description}`;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TITLE_TIMEOUT_MS);

  try {
    const q = query({
      prompt,
      options: {
        model: TITLE_MODEL,
        env,
        abortController,
        permissionMode: 'dontAsk',
        allowedTools: [],
        disallowedTools: ['*'],
        settingSources: [],
        persistSession: false,
      },
    });

    let title: string | null = null;
    for await (const m of q) {
      if (m.type === 'result' && m.subtype === 'success') {
        title = cleanTitle(m.result.trim());
      }
    }

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
