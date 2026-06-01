import type { DisplayBlock } from 'shared/types';
import { basename } from '../../../lib/file-icons';
import { FileBadge } from './file-badge';

interface FileRowProps {
  path: string;
  /** When present, render +N -N stats from diff lines. */
  diff?: { oldText: string; newText: string };
}

function countDiff(oldText: string, newText: string): { plus: number; minus: number } {
  // Cheap shape-aware diff: count lines that differ.
  // For pure-add (oldText === '') we count all newText lines as +.
  // For pure-delete (newText === '') we count all oldText lines as -.
  if (oldText === '' && newText !== '') {
    return { plus: newText.split('\n').length, minus: 0 };
  }
  if (newText === '' && oldText !== '') {
    return { plus: 0, minus: oldText.split('\n').length };
  }
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const oldSet = new Map<string, number>();
  for (const l of oldLines) oldSet.set(l, (oldSet.get(l) ?? 0) + 1);
  const newSet = new Map<string, number>();
  for (const l of newLines) newSet.set(l, (newSet.get(l) ?? 0) + 1);
  let plus = 0;
  let minus = 0;
  for (const [line, cnt] of newSet) {
    const had = oldSet.get(line) ?? 0;
    if (cnt > had) plus += cnt - had;
  }
  for (const [line, cnt] of oldSet) {
    const has = newSet.get(line) ?? 0;
    if (cnt > has) minus += cnt - has;
  }
  return { plus, minus };
}

export function FileRow({ path, diff }: FileRowProps) {
  const name = basename(path);
  const stats = diff ? countDiff(diff.oldText, diff.newText) : null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <FileBadge path={path} />
      <span className="text-foreground/85 font-mono">{name}</span>
      {stats && (stats.plus > 0 || stats.minus > 0) && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
          {stats.plus > 0 && <span className="text-success">+{stats.plus}</span>}
          {stats.minus > 0 && <span className="text-destructive">-{stats.minus}</span>}
        </span>
      )}
    </div>
  );
}

/** File rows extracted from a result's display blocks (diff entries). */
export function FileRowsFromDisplay({ blocks }: { blocks: DisplayBlock[] }) {
  const diffs = blocks.filter(
    (b): b is Extract<DisplayBlock, { type: 'diff' }> => b.type === 'diff',
  );
  if (diffs.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {diffs.map((d) => (
        <FileRow key={d.path} path={d.path} diff={{ oldText: d.oldText, newText: d.newText }} />
      ))}
    </div>
  );
}
