import { Eye, FilePlus2, Search } from 'lucide-react';
import type { DisplayBlock } from 'shared/types';
import { basename } from '../../../../lib/file-icons';
import { FileBadge } from '../file-badge';
import { FileRow, FileRowsFromDisplay } from '../file-row';
import type { Adapter, AdapterContext, RailRowShape } from '../types';
import { readArgString, statusOf } from '../types';

function plainOutput(ctx: AdapterContext): string {
  const o = ctx.result?.output;
  if (typeof o === 'string') return o;
  return '';
}

/** Claude `Read` — `file_path` (plus optional `offset`/`limit`). Handles text and media. */
export const ReadFileAdapter: Adapter = (ctx): RailRowShape => {
  const path = readArgString(ctx.call, 'file_path');
  const status = statusOf(ctx);
  return {
    icon: <Eye className="h-3.5 w-3.5" />,
    verb: 'Read',
    inline: path ? <FileInlineToken path={path} /> : undefined,
    status,
  };
};

/** Inline filename token (used after a verb like "Read"). */
function FileInlineToken({ path }: { path: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <FileBadge path={path} />
      <span className="font-mono text-muted-foreground/85">{basename(path)}</span>
    </span>
  );
}

/** Claude `Write` — `file_path`, `content`. */
export const WriteFileAdapter: Adapter = (ctx): RailRowShape => {
  const path = readArgString(ctx.call, 'file_path');
  const display = (ctx.result?.displayBlocks ?? []) as DisplayBlock[];
  const diffs = display.filter(
    (d): d is Extract<DisplayBlock, { type: 'diff' }> => d.type === 'diff',
  );
  // Detail prefers display-derived FileRows (with stats). Fallback to single
  // bare FileRow from args.file_path when no display data arrived (e.g. streaming).
  let detail: RailRowShape['detail'];
  if (diffs.length > 0) {
    detail = <FileRowsFromDisplay blocks={display} />;
  } else if (path) {
    detail = <FileRow path={path} />;
  }
  const count = diffs.length || (path ? 1 : 0);
  const verb = count > 1 ? `Created ${count} files` : 'Created 1 file';
  return {
    icon: <FilePlus2 className="h-3.5 w-3.5" />,
    verb,
    detail,
    status: statusOf(ctx),
  };
};

/** Claude `Glob` — `pattern`, `path`. */
export const GlobAdapter: Adapter = (ctx): RailRowShape => {
  const pattern = readArgString(ctx.call, 'pattern');
  const output = plainOutput(ctx).trim();
  const lines = output ? output.split('\n').filter(Boolean) : [];
  const status = statusOf(ctx);
  let detail: RailRowShape['detail'];
  if (status !== 'running') {
    if (lines.length === 0) {
      detail = <div className="text-xs text-muted-foreground/70">No results found</div>;
    } else {
      const verbMsg =
        ctx.result?.message ?? `Found ${lines.length} ${lines.length === 1 ? 'file' : 'files'}`;
      detail = <FileListDetail message={verbMsg} files={lines} />;
    }
  }
  return {
    icon: <Search className="h-3.5 w-3.5" />,
    verb: 'Searched',
    inline: pattern ? (
      <span className="font-mono text-muted-foreground/75">{pattern}</span>
    ) : undefined,
    detail,
    status,
  };
};

/** Claude `Grep` — `pattern`, `path`, `glob`, `output_mode`. */
export const GrepAdapter: Adapter = (ctx): RailRowShape => {
  const pattern = readArgString(ctx.call, 'pattern');
  const path = readArgString(ctx.call, 'path');
  const glob = readArgString(ctx.call, 'glob');
  const output = plainOutput(ctx).trim();
  const status = statusOf(ctx);
  let detail: RailRowShape['detail'];
  if (status !== 'running') {
    if (output === '') {
      detail = <div className="text-xs text-muted-foreground/70">No matches</div>;
    } else {
      detail = (
        <div className="rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] text-muted-foreground/95 max-h-56 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words select-text">
          {output}
        </div>
      );
    }
  }
  const scope = path ? basename(path) || path : glob;
  return {
    icon: <Search className="h-3.5 w-3.5" />,
    verb: 'Searched',
    inline: (
      <span className="font-mono text-muted-foreground/75">
        {pattern}
        {scope && <span className="text-muted-foreground/55"> · {scope}</span>}
      </span>
    ),
    detail,
    status,
  };
};

function FileListDetail({ message, files }: { message: string; files: string[] }) {
  const MAX = 12;
  const shown = files.slice(0, MAX);
  const hidden = files.length - MAX;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground/70">{message}</div>
      <ul className="space-y-0.5">
        {shown.map((p) => (
          <li key={p}>
            <FileRow path={p} />
          </li>
        ))}
        {hidden > 0 && (
          <li className="text-[11px] text-muted-foreground/55 pl-1">… and {hidden} more</li>
        )}
      </ul>
    </div>
  );
}
