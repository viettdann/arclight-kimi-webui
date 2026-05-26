import { getFileIcon } from '../../../lib/file-icons';
import { cn } from '../../../lib/utils';

interface FileBadgeProps {
  path: string;
  className?: string;
}

/** Generic lucide file icon next to a filename in the tool-call timeline. */
export function FileBadge({ path, className }: FileBadgeProps) {
  const { Icon, className: color, label } = getFileIcon(path);
  return <Icon aria-label={label} className={cn('h-3.5 w-3.5 shrink-0', color, className)} />;
}
