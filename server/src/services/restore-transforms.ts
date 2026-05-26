/**
 * Strip leading `_system_prompt` JSONL line(s) from a restored
 * `context.jsonl` blob.
 *
 * The kimi-cli runtime re-renders the system prompt header on attach using
 * the current workDir and config. Carrying the prior machine's rendered
 * header across an adopt would leave stale workspace paths embedded in the
 * context; drop the leading header line(s) and let the SDK emit fresh ones.
 *
 * Behavior:
 * - Walks from byte 0, skipping `\n`-only blank lines.
 * - As long as the next non-empty line parses to JSON with
 *   `role === '_system_prompt'`, advance past it and continue.
 * - Stop at the first non-empty line that does NOT parse to that shape.
 * - Return the slice from the stop position to end of input. Bytes between
 *   input start and stop position are dropped (including blank lines
 *   interleaved with stripped head lines).
 * - If no leading `_system_prompt` line exists: return input unchanged.
 * - Trailing newline (if any) is preserved by the slice.
 */
export function stripSystemPromptHead(contextJsonl: string): string {
  const len = contextJsonl.length;
  if (len === 0) return contextJsonl;

  let cursor = 0;
  let strippedAny = false;

  while (cursor < len) {
    let probe = cursor;
    while (probe < len && contextJsonl[probe] === '\n') probe++;
    if (probe >= len) {
      if (strippedAny) cursor = probe;
      break;
    }

    const nlIdx = contextJsonl.indexOf('\n', probe);
    const lineEnd = nlIdx === -1 ? len : nlIdx;
    const line = contextJsonl.slice(probe, lineEnd);

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      cursor = probe;
      break;
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { role?: unknown }).role === '_system_prompt'
    ) {
      cursor = nlIdx === -1 ? len : nlIdx + 1;
      strippedAny = true;
      continue;
    }

    cursor = probe;
    break;
  }

  if (!strippedAny) return contextJsonl;
  return contextJsonl.slice(cursor);
}

/**
 * Sanitize a `state.json` blob before restoring to disk.
 *
 * - Empty input or parse failure: return unchanged.
 * - Otherwise set `data.additional_dirs = []` (foreign machine paths must
 *   not leak across an adopt) and serialize back with 2-space indent.
 */
export function sanitizeStateJson(stateJson: string): string {
  if (stateJson.length === 0) return stateJson;
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(stateJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return stateJson;
    data = parsed as Record<string, unknown>;
  } catch {
    return stateJson;
  }
  data.additional_dirs = [];
  return JSON.stringify(data, null, 2);
}
