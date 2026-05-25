// Parses inline harness tags injected by the agent harness (Kimi backend),
// e.g. <git-context>...</git-context>, <jit-context>...</jit-context>.
// Any lowercase tag name with dashes is detected — no allowlist — so the UI
// still degrades gracefully when the harness introduces new tag types.

export type HarnessSegment =
  | { kind: 'text'; content: string }
  | { kind: 'tag'; name: string; content: string };

const TAG_RE = /<([a-z][a-z0-9-]*)>([\s\S]*?)<\/\1>/g;

export function parseHarnessTags(input: string): HarnessSegment[] {
  if (!input) return [];
  const segments: HarnessSegment[] = [];
  let cursor = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(input)) !== null) {
    if (m.index > cursor) {
      const pre = input.slice(cursor, m.index);
      if (pre) segments.push({ kind: 'text', content: pre });
    }
    segments.push({ kind: 'tag', name: m[1] ?? '', content: (m[2] ?? '').trim() });
    cursor = m.index + m[0].length;
  }
  if (cursor < input.length) {
    const rest = input.slice(cursor);
    if (rest) segments.push({ kind: 'text', content: rest });
  }
  return segments;
}

/** Strip harness tags and return plain prompt text (single line, trimmed). */
export function stripHarnessTags(input: string): string {
  if (!input) return '';
  return input.replace(TAG_RE, '').replace(/\s+/g, ' ').trim();
}
