// Maps Claude tool data → DisplayBlock[] for the chat timeline. The client's
// timeline adapters render everything else from raw args/output, so this only
// covers the tools whose preview wants structured shaping (shell command,
// file diff, todo list). Defensive throughout — never throws on missing or
// malformed fields; an unrecognized/empty shape yields `[]`.
//
// Imported by BOTH this renderer (reload path) and the live output-consumer
// under the exact signature below. Do NOT change the signature.

import type { DisplayBlock } from 'shared/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Reconstruct `{ oldText, newText }` from a Claude `structuredPatch` (array of
 * hunks). Each hunk's `lines` carry the unified-diff prefix: ` ` context goes
 * to both sides, `-` to old only, `+` to new only. Returns null when the patch
 * is absent or unusable so callers can fall back to `input` strings.
 */
function reconstructFromPatch(patch: unknown): { oldText: string; newText: string } | null {
  if (!Array.isArray(patch) || patch.length === 0) return null;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let sawAny = false;
  for (const rawHunk of patch) {
    if (!isRecord(rawHunk) || !Array.isArray(rawHunk.lines)) continue;
    for (const line of rawHunk.lines) {
      if (typeof line !== 'string') continue;
      sawAny = true;
      const marker = line[0];
      const body = line.slice(1);
      if (marker === '+') {
        newLines.push(body);
      } else if (marker === '-') {
        oldLines.push(body);
      } else {
        // Context (leading space) or any unexpected prefix → both sides.
        oldLines.push(body);
        newLines.push(body);
      }
    }
  }
  if (!sawAny) return null;
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

/** Normalize a TodoWrite status onto the DisplayBlock todo vocabulary. */
function mapTodoStatus(status: unknown): 'pending' | 'in_progress' | 'done' {
  switch (status) {
    case 'in_progress':
      return 'in_progress';
    case 'completed':
    case 'done':
      return 'done';
    default:
      return 'pending';
  }
}

export function toDisplayBlocks(
  toolName: string,
  input: unknown,
  _resultContent: unknown,
  toolUseResult?: unknown,
): DisplayBlock[] {
  const args = isRecord(input) ? input : {};
  const result = isRecord(toolUseResult) ? toolUseResult : undefined;

  switch (toolName) {
    case 'Bash': {
      return [{ type: 'shell', command: str(args.command), language: 'bash' }];
    }

    case 'Write': {
      // Write replaces the whole file: old side is whatever the patch shows
      // (often empty for a new file), new side is the written content.
      const fromPatch = reconstructFromPatch(result?.structuredPatch);
      const path = str(args.file_path) || str(result?.filePath);
      if (fromPatch) {
        return [{ type: 'diff', path, oldText: fromPatch.oldText, newText: fromPatch.newText }];
      }
      return [{ type: 'diff', path, oldText: '', newText: str(args.content) }];
    }

    case 'Edit':
    case 'MultiEdit': {
      const fromPatch = reconstructFromPatch(result?.structuredPatch);
      const path = str(args.file_path) || str(result?.filePath);
      if (fromPatch) {
        return [{ type: 'diff', path, oldText: fromPatch.oldText, newText: fromPatch.newText }];
      }
      return [
        {
          type: 'diff',
          path,
          oldText: str(args.old_string),
          newText: str(args.new_string),
        },
      ];
    }

    case 'TodoWrite': {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      return [
        {
          type: 'todo',
          items: todos.map((t) => {
            const todo = isRecord(t) ? t : {};
            const title = str(todo.content) || str(todo.title);
            return { title, status: mapTodoStatus(todo.status) };
          }),
        },
      ];
    }

    default:
      return [];
  }
}
