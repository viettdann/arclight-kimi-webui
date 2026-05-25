import { ChevronDown, ChevronRight, Tag } from 'lucide-react';
import { useState } from 'react';

interface HarnessTagBlockProps {
  name: string;
  content: string;
}

export function HarnessTagBlock({ name, content }: HarnessTagBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Tag className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
          <span className="font-mono text-foreground/80 truncate">{name}</span>
          {lineCount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {isOpen && content && (
        <div className="px-3 py-2 border-t border-border/50 bg-background/40 text-[11px] font-mono text-foreground/80 max-h-72 overflow-y-auto scrollbar-thin select-text">
          <pre className="whitespace-pre-wrap break-words leading-relaxed">{content}</pre>
        </div>
      )}
    </div>
  );
}
