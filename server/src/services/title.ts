import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { kimiPaths } from './kimi-config/paths';

// Defensive title extraction. `state.json` is an internal Kimi CLI artifact,
// not a published SDK contract — the field name, presence, or shape may change
// across versions. We tolerate any drift by returning `null` whenever the file
// is missing, unreadable, malformed, or doesn't carry the expected field.
//
// The Kimi runtime seeds `custom_title` with the first user prompt on the
// opening turn and flips `title_generated` to `true` only after its own AI
// pass writes a real title. Callers must consult `generated` to avoid treating
// the seeded placeholder as authoritative.
//
// The CI tripwire (`server/test/state-json-shape.test.ts`, gated by
// RUN_SDK_INTEGRATION) is what alerts maintainers when the upstream shape
// changes; runtime stays silent and degrades to "no title".

export interface ExtractedTitle {
  title: string;
  /** Mirrors `state.json#title_generated`. False ⇒ seeded placeholder. */
  generated: boolean;
}

export async function extractTitle(stateJsonPath: string): Promise<ExtractedTitle | null> {
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
  const generated = obj.title_generated === true;
  return { title: t, generated };
}

/** Convenience: locate `state.json` for a given Kimi session. */
export function stateJsonPathFor(workDir: string, kimiSessionId: string): string {
  return path.join(kimiPaths().sessionDir(workDir, kimiSessionId), 'state.json');
}
