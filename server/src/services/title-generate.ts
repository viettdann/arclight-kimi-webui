// Background title generator. Fires after the first successful turn of a
// session whose `kimi_sessions.title` is still NULL, calls the upstream
// Anthropic-compatible `/messages` endpoint via the provider configured in
// `kimi_config`, writes the result to DB, and broadcasts `title_update`.
//
// Why direct fetch instead of the SDK: the SDK's `prompt()` spawns a full
// agent turn (system prompt, tools, skills, thinking), which is ~3 orders of
// magnitude more expensive than a single chat completion just to produce a
// 50-character string. The Kimi-managed deployment at
// `https://api.kimi.com/coding/v1` accepts the Anthropic Messages shape
// without a whitelisted User-Agent (the OpenAI `/chat/completions` path 403s
// on non-coding-agent UAs), so this module hits `${baseUrl}/messages` with
// `x-api-key`.
//
// Fire-and-forget: caller invokes `void maybeGenerateTitleBackground(...)`.
// Failures fall back to the shortened first user message so the UI always
// shows something better than "Untitled".

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { type DB, db as defaultDb, schema } from '../db';
import { logger } from '../lib/logger';
import { broadcastEvent } from '../lib/ws-broadcast';
import { loadOrSeed } from './kimi-config/load-or-seed';
import { kimiPaths } from './kimi-config/paths';
import type { ActiveSession, KimiSessionManager } from './session-manager';

const TITLE_MAX_CHARS = 50;
const SYSTEM_PROMPT =
  'Generate a concise session title (max 50 characters) based on the conversation. ' +
  'Only respond with the title text, nothing else. No quotes, no explanation.';
const REQUEST_TIMEOUT_MS = 30_000;
const USER_TEXT_CAP = 300;
const ASSISTANT_TEXT_CAP = 300;

/** Sessions with title-generation currently in flight. Single-server, in-memory. */
const inflight = new Set<string>();

export interface TitleProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface FirstTurn {
  userText: string;
  assistantText: string;
}

/**
 * Read the wire.jsonl file and return the first user input + first assistant
 * text from the opening turn. Returns null if the file is missing, empty, or
 * malformed.
 *
 * Wire shape (per @moonshot-ai/kimi-agent-sdk@0.1.8 protocol 1.10):
 *   { "message": { "type": "TurnBegin", "payload": { "user_input": <string | ContentPart[]> } } }
 *   { "message": { "type": "ContentPart", "payload": { "type": "text", "text": "..." } } }
 *
 * We accept the first TurnBegin then the first text-type ContentPart that
 * follows. Think parts are skipped.
 */
export async function readFirstTurnFromWire(wirePath: string): Promise<FirstTurn | null> {
  let raw: string;
  try {
    raw = await readFile(wirePath, 'utf8');
  } catch {
    return null;
  }

  let userText = '';
  let assistantText = '';
  let sawTurnBegin = false;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record || typeof record !== 'object') continue;
    const message = (record as { message?: unknown }).message;
    if (!message || typeof message !== 'object') continue;
    const type = (message as { type?: unknown }).type;
    const payload = (message as { payload?: unknown }).payload;

    if (type === 'TurnBegin' && !sawTurnBegin) {
      sawTurnBegin = true;
      userText = extractUserInputText((payload as { user_input?: unknown })?.user_input);
      continue;
    }

    if (sawTurnBegin && type === 'ContentPart' && payload && typeof payload === 'object') {
      const partType = (payload as { type?: unknown }).type;
      if (partType !== 'text') continue;
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) {
        assistantText = text;
        break;
      }
    }
  }

  if (!userText) return null;
  return { userText, assistantText };
}

function extractUserInputText(input: unknown): string {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) {
    return input
      .filter((p): p is { type: string; text: string } => {
        return (
          p != null &&
          typeof p === 'object' &&
          (p as { type?: unknown }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string'
        );
      })
      .map((p) => p.text)
      .join('\n')
      .trim();
  }
  return '';
}

/**
 * POST `${baseUrl}/messages` with the Anthropic Messages shape and parse the
 * first text block from the response. Throws on HTTP error, network error,
 * timeout, or unparseable response.
 */
export async function generateTitleViaAnthropic(
  cfg: TitleProviderConfig,
  userText: string,
  assistantText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/messages`;
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: 60,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `User: ${userText.slice(0, USER_TEXT_CAP)}\n` +
          `Assistant: ${assistantText.slice(0, ASSISTANT_TEXT_CAP)}\n\n` +
          'Title:',
      },
    ],
  });

  logger.info(
    {
      url,
      model: cfg.model,
      apiKeyPrefix: cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}…(${cfg.apiKey.length})` : '(empty)',
      userLen: userText.length,
      assistantLen: assistantText.length,
    },
    'title-generate: POST /messages',
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    logger.warn(
      { url, status: res.status, body: errBody.slice(0, 200) },
      'title-generate: provider HTTP error',
    );
    throw new Error(`title generation HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') throw new Error('title generation: non-object response');
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('title generation: empty content array');
  }
  const firstText = content.find(
    (b): b is { type: string; text: string } =>
      b != null &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === 'text' &&
      typeof (b as { text?: unknown }).text === 'string',
  );
  if (!firstText) throw new Error('title generation: no text block in response');
  const cleaned = cleanTitle(firstText.text);
  logger.info(
    { url, raw: firstText.text.slice(0, 100), cleaned },
    'title-generate: provider returned title',
  );
  return cleaned;
}

/** Strip leading/trailing whitespace + surrounding quotes, then cap to 50 chars. */
export function cleanTitle(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (stripped.length <= TITLE_MAX_CHARS) return stripped;
  return `${stripped.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/** Shorten any text to ≤50 chars for fallback use. */
export function shortenForTitle(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  return cleanTitle(collapsed);
}

export interface MaybeGenerateOpts {
  /** Override fetch impl for tests. */
  fetchImpl?: typeof fetch;
  /** Override config loader (for tests). */
  loadConfig?: (db: DB) => Promise<TitleProviderConfig | null>;
  /** Override wire reader (for tests). */
  readWire?: (wirePath: string) => Promise<FirstTurn | null>;
  /** Override path resolver (for tests). */
  resolveWirePath?: (workDir: string, kimiSessionId: string) => string;
}

/**
 * Fire-and-forget. Resolves quickly on no-op paths (already titled, already
 * in flight, no first user message). On a real generation path, awaits the
 * HTTP roundtrip, writes DB, broadcasts. Never throws — all errors are
 * logged and degrade to a shortened-user-message fallback.
 */
export async function maybeGenerateTitleBackground(
  active: ActiveSession,
  manager: KimiSessionManager,
  database: DB = defaultDb,
  opts: MaybeGenerateOpts = {},
): Promise<void> {
  if (inflight.has(active.sessionId)) {
    logger.info({ sessionId: active.sessionId }, 'title-generate: skip (inflight)');
    return;
  }

  // Skip if a title already exists (set by /title slash, custom_title, or a
  // previous run of this generator). The check is best-effort — a race with
  // a concurrent setter is harmless because both writers converge on the
  // same row and a subsequent broadcast just re-emits the same title.
  const [existing] = await database
    .select({ title: schema.kimiSessions.title })
    .from(schema.kimiSessions)
    .where(eq(schema.kimiSessions.id, active.sessionId))
    .limit(1);
  if (!existing) {
    logger.info({ sessionId: active.sessionId }, 'title-generate: skip (session row missing)');
    return;
  }
  if (existing.title && existing.title.trim().length > 0) {
    logger.info(
      { sessionId: active.sessionId, existing: existing.title },
      'title-generate: skip (already titled)',
    );
    return;
  }
  logger.info({ sessionId: active.sessionId }, 'title-generate: starting');

  inflight.add(active.sessionId);
  try {
    const resolveWirePath =
      opts.resolveWirePath ??
      ((workDir, kimiSessionId) =>
        path.join(kimiPaths().sessionDir(workDir, kimiSessionId), 'wire.jsonl'));
    const wirePath = resolveWirePath(active.workDir, active.kimiSessionId);

    const readWire = opts.readWire ?? readFirstTurnFromWire;
    const turn = await readWire(wirePath);
    if (!turn?.userText) {
      logger.warn(
        { sessionId: active.sessionId, wirePath },
        'title-generate: skip (no first user turn in wire.jsonl)',
      );
      return;
    }

    const loadCfg = opts.loadConfig ?? defaultLoadConfig;
    const cfg = await loadCfg(database);

    let title: string | null = null;
    if (!cfg) {
      logger.warn(
        { sessionId: active.sessionId },
        'title-generate: no provider config, will fallback',
      );
    } else if (!cfg.apiKey) {
      logger.warn(
        { sessionId: active.sessionId, baseUrl: cfg.baseUrl, model: cfg.model },
        'title-generate: provider apiKey empty, will fallback',
      );
    } else {
      try {
        title = await generateTitleViaAnthropic(
          cfg,
          turn.userText,
          turn.assistantText,
          opts.fetchImpl ?? fetch,
        );
      } catch (err) {
        logger.warn(
          { err, sessionId: active.sessionId, baseUrl: cfg.baseUrl, model: cfg.model },
          'title generation failed, falling back to user message',
        );
      }
    }
    if (!title) {
      title = shortenForTitle(turn.userText);
      logger.info(
        { sessionId: active.sessionId, fallback: title },
        'title-generate: using fallback first-message title',
      );
    }
    if (!title) return;

    await database
      .update(schema.kimiSessions)
      .set({ title })
      .where(eq(schema.kimiSessions.id, active.sessionId));
    broadcastEvent(active, 'title_update', { title }, manager);
  } catch (err) {
    logger.warn({ err, sessionId: active.sessionId }, 'background title generator crashed');
  } finally {
    inflight.delete(active.sessionId);
  }
}

async function defaultLoadConfig(database: DB): Promise<TitleProviderConfig | null> {
  try {
    const row = await loadOrSeed(database);
    const alias = row.defaults.model;
    const modelEntry = row.models[alias];
    const apiModel = modelEntry?.model ?? alias;
    if (!row.provider.baseUrl) return null;
    return {
      baseUrl: row.provider.baseUrl,
      apiKey: row.provider.apiKey,
      model: apiModel,
    };
  } catch (err) {
    logger.warn({ err }, 'title-generate: failed to load kimi_config');
    return null;
  }
}

/** Test helper. Clears the in-flight set so test files don't leak state. */
export function __resetInflightForTests(): void {
  inflight.clear();
}
