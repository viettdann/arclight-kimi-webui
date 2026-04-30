import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { KimiPaths } from '@moonshot-ai/kimi-agent-sdk';

// Defensive title extraction. `state.json` is an internal Kimi CLI artifact,
// not a published SDK contract — the field name, presence, or shape may change
// across versions. We tolerate any drift by returning `null` whenever the file
// is missing, unreadable, malformed, or doesn't carry the expected field.
//
// The CI tripwire (`server/test/state-json-shape.test.ts`, gated by
// RUN_SDK_INTEGRATION) is what alerts maintainers when the upstream shape
// changes; runtime stays silent and degrades to "no title".

export async function extractTitle(stateJsonPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(stateJsonPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const t = obj.custom_title;
  if (typeof t !== 'string' || t.length === 0) return null;
  return t;
}

/** Convenience: locate `state.json` for a given Kimi session. */
export function stateJsonPathFor(workDir: string, kimiSessionId: string): string {
  return path.join(KimiPaths.sessionDir(workDir, kimiSessionId), 'state.json');
}
