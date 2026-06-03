import { NotebookPen, PencilLine } from 'lucide-react';
import type { DisplayBlock } from 'shared/types';
import { FileRow, FileRowsFromDisplay } from '../file-row';
import type { Adapter, AdapterContext, RailRowShape } from '../types';
import { parseArgs, readArgString, statusOf } from '../types';

function diffsOf(ctx: AdapterContext): Extract<DisplayBlock, { type: 'diff' }>[] {
  const display = (ctx.result?.displayBlocks ?? []) as DisplayBlock[];
  return display.filter((d): d is Extract<DisplayBlock, { type: 'diff' }> => d.type === 'diff');
}

/**
 * Build the edit detail + file count. Diffs from `result.displayBlocks` win;
 * otherwise fall back to a bare FileRow for the edited path so a streaming or
 * display-less result still names the file.
 */
function editShape(ctx: AdapterContext, path: string): RailRowShape {
  const display = (ctx.result?.displayBlocks ?? []) as DisplayBlock[];
  const diffs = diffsOf(ctx);
  let detail: RailRowShape['detail'];
  if (diffs.length > 0) {
    detail = <FileRowsFromDisplay blocks={display} />;
  } else if (path) {
    detail = <FileRow path={path} />;
  }
  const count = diffs.length || (path ? 1 : 0);
  const verb = count > 1 ? `Edited ${count} files` : 'Edited 1 file';
  return {
    icon: <PencilLine className="h-3.5 w-3.5" />,
    verb,
    detail,
    status: statusOf(ctx),
  };
}

/** Claude `Edit` — `file_path`, `old_string`, `new_string`, `replace_all`. */
export const EditFileAdapter: Adapter = (ctx): RailRowShape =>
  editShape(ctx, readArgString(ctx.call, 'file_path'));

/** Claude `MultiEdit` — `file_path`, `edits[]`. */
export const MultiEditFileAdapter: Adapter = (ctx): RailRowShape => {
  const path = readArgString(ctx.call, 'file_path');
  // Display diffs win — they carry real before/after stats.
  if (diffsOf(ctx).length > 0) return editShape(ctx, path);
  // No display diffs (streaming or display-less): name the file and surface
  // the in-file edit count from args.edits.
  const args = parseArgs(ctx.call);
  const edits = args && Array.isArray(args.edits) ? args.edits.length : 0;
  const verb = edits > 1 ? `Edited 1 file (${edits} changes)` : 'Edited 1 file';
  return {
    icon: <PencilLine className="h-3.5 w-3.5" />,
    verb,
    detail: path ? <FileRow path={path} /> : undefined,
    status: statusOf(ctx),
  };
};

/** Claude `NotebookEdit` — `notebook_path`, `new_source`, `cell_type`, `edit_mode`. */
export const NotebookEditAdapter: Adapter = (ctx): RailRowShape => {
  const path = readArgString(ctx.call, 'notebook_path');
  const base = editShape(ctx, path);
  return { ...base, icon: <NotebookPen className="h-3.5 w-3.5" /> };
};
