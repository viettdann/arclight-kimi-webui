#!/usr/bin/env bun
/**
 * Kimi SDK smoke repro. Verifies the wrapper assumptions hold at runtime:
 *   1. createSession({ workDir }) starts a session.
 *   2. session.prompt(...) returns an async-iterable Turn.
 *   3. Iterator yields StreamEvent objects shaped per `dist/index.d.ts`.
 *   4. createSession({ sessionId }) re-attaches an existing session by id
 *      (after the first run wrote files to ~/.kimi/sessions/{hash}/{id}/).
 *
 * Usage:
 *   KIMI_SMOKE_PROMPT='hello' bun server/scripts/kimi-smoke.ts [workDir]
 *
 * Requires the user to have completed `kimi login` (SDK uses ~/.kimi/auth.json).
 * Skips API calls if KIMI_SMOKE_PROMPT is unset — only prints the resolved
 * session dir + reattach attempt, useful for verifying paths offline.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createSession, KimiPaths } from '@moonshot-ai/kimi-agent-sdk';

const workDir = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'workspace', 'smoke'));
await mkdir(workDir, { recursive: true });

const prompt = process.env.KIMI_SMOKE_PROMPT;

console.log('[smoke] workDir:', workDir);
console.log('[smoke] sessionsDir:', KimiPaths.sessionsDir(workDir));

const session = createSession({ workDir });
console.log('[smoke] created session:', {
  sessionId: session.sessionId,
  state: session.state,
  workDir: session.workDir,
});

const dirAfterCreate = KimiPaths.sessionDir(workDir, session.sessionId);
console.log('[smoke] sessionDir:', dirAfterCreate, 'exists?', existsSync(dirAfterCreate));

if (!prompt) {
  console.log('[smoke] KIMI_SMOKE_PROMPT unset — skipping turn.');
  await session.close();
  process.exit(0);
}

console.log('[smoke] sending prompt:', prompt);
const turn = session.prompt(prompt);
const seenTypes = new Set<string>();
let textChunks = 0;
let totalTextLen = 0;
const textChunkLens: number[] = [];
let toolCalls = 0;

for await (const ev of turn) {
  seenTypes.add(ev.type);
  if (ev.type === 'ContentPart') {
    const p = ev.payload as { type: string; text?: string; think?: string };
    if (p.type === 'text' && typeof p.text === 'string') {
      textChunks += 1;
      totalTextLen += p.text.length;
      textChunkLens.push(p.text.length);
      console.log(
        '[event] ContentPart text len=',
        p.text.length,
        'preview=',
        JSON.stringify(p.text.slice(0, 60)),
      );
      continue;
    }
    if (p.type === 'think') {
      console.log('[event] ContentPart think len=', (p.think ?? '').length);
      continue;
    }
    console.log('[event] ContentPart other type=', p.type);
    continue;
  }
  if (ev.type === 'ToolCall') {
    toolCalls += 1;
    console.log('[event] ToolCall', JSON.stringify(ev.payload).slice(0, 120));
    continue;
  }
  if (ev.type === 'ToolCallPart') {
    console.log('[event] ToolCallPart', JSON.stringify(ev.payload));
    continue;
  }
  console.log('[event]', ev.type);
}

const result = await turn.result;
console.log('[smoke] result:', result);
console.log('[smoke] event types seen:', [...seenTypes]);
console.log(
  '[smoke] text chunks:',
  textChunks,
  'total text len:',
  totalTextLen,
  'avg chunk len:',
  textChunks > 0 ? Math.round(totalTextLen / textChunks) : 0,
  'tool calls:',
  toolCalls,
);
console.log('[smoke] text chunk lens (first 10):', textChunkLens.slice(0, 10));

const reattachedId = session.sessionId;
await session.close();

console.log('[smoke] reattach test: createSession({ sessionId:', reattachedId, '})');
const restored = createSession({ workDir, sessionId: reattachedId });
console.log('[smoke] restored:', {
  sessionId: restored.sessionId,
  matches: restored.sessionId === reattachedId,
  state: restored.state,
});
await restored.close();
console.log('[smoke] done');
