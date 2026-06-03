import { Check, Compass } from 'lucide-react';

interface SteerBlockProps {
  content: string;
  createdAt: string;
}

export function SteerBlock({ content, createdAt }: SteerBlockProps) {
  return (
    <div className="flex flex-col items-end gap-1 w-full animate-in fade-in duration-200">
      <div className="flex items-center gap-2 max-w-[80%] rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium shadow-sm backdrop-blur-sm select-text break-words">
        <Compass className="h-4 w-4 shrink-0 text-amber-500" />
        <span>Steered Prompt:</span>
        <span className="font-semibold text-foreground/90">{content}</span>
      </div>
      <div className="flex items-center gap-1 px-1 text-[9px] text-muted-foreground select-none font-medium">
        <span>
          {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <Check className="h-3 w-3 text-muted-foreground/45" />
      </div>
    </div>
  );
}
