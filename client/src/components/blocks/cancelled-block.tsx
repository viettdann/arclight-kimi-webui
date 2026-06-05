import { CircleSlash } from 'lucide-react';

interface CancelledBlockProps {
  createdAt: string;
}

/** Quiet marker for a turn the user interrupted — not an error. */
export function CancelledBlock({ createdAt }: CancelledBlockProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in duration-200 select-text">
      <CircleSlash className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">Interrupted by user</span>
      <span className="text-[9px] text-muted-foreground/60 font-mono select-none">
        {new Date(createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  );
}
