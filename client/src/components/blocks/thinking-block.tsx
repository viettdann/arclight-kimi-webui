import { Brain, ChevronDown, ChevronRight, Loader2, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ThinkingBlockProps {
  content: string;
  encrypted?: boolean;
  isStreaming?: boolean;
}

export function ThinkingBlock({ content, encrypted, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(isStreaming === true);
  const prevStreamingRef = useRef<boolean | undefined>(isStreaming);

  useEffect(() => {
    const prev = prevStreamingRef.current;
    if (prev && !isStreaming) {
      setIsOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const toggleOpen = () => setIsOpen((v) => !v);

  if (isStreaming) {
    return (
      <div className="rounded-xl border border-border/80 bg-muted/10 shadow-sm backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
        <button
          onClick={toggleOpen}
          className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-muted-foreground/80 hover:text-foreground transition-colors select-none cursor-pointer hover:bg-muted/20"
        >
          <div className="flex items-center gap-2">
            <Loader2 className="h-4.5 w-4.5 text-primary animate-spin" />
            <span>Thinking...</span>
            {encrypted && (
              <span className="flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-mono font-medium">
                <Lock className="h-2.5 w-2.5" />
                <span>Encrypted</span>
              </span>
            )}
          </div>
          <div>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </button>

        {isOpen && (
          <div className="px-4 pb-3 pt-1 border-t border-border/40 text-xs font-mono text-muted-foreground/80 leading-relaxed whitespace-pre-wrap select-text break-words max-h-72 overflow-y-auto scrollbar-thin">
            {content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-1">
      <button
        onClick={toggleOpen}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors select-none cursor-pointer"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Brain className="h-3.5 w-3.5 text-primary/60 shrink-0" />
        <span>Thought process</span>
      </button>

      {isOpen && (
        <div className="mt-1 text-xs font-mono text-muted-foreground/70 leading-relaxed whitespace-pre-wrap select-text break-words max-h-72 overflow-y-auto scrollbar-thin">
          {content}
        </div>
      )}
    </div>
  );
}
