import { getFileIcon } from '../../../lib/file-icons';

interface FileBadgeProps {
  path: string;
  className?: string;
}

/** Two-to-four letter badge next to a filename (TS, MD, JSON, …). */
export function FileBadge({ path, className = '' }: FileBadgeProps) {
  const spec = getFileIcon(path);
  return (
    <span
      className={`inline-flex items-center justify-center px-1 min-w-[1.75rem] h-4 rounded-sm font-mono text-[9px] font-bold uppercase tracking-tight tabular-nums leading-none select-none ${spec.className} ${className}`}
    >
      {spec.label}
    </span>
  );
}
