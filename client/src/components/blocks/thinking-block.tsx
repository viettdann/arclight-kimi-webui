import { Brain, ChevronDown, ChevronRight, Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ThinkingBlockProps {
  content: string;
  encrypted?: boolean;
  isStreaming?: boolean;
}

export function ThinkingBlock({ content, encrypted, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Keep open when streaming to show live updates
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  const toggleOpen = () => {
    if (!isStreaming) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className="rounded-xl border border-border/80 bg-muted/10 shadow-sm backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <button
        onClick={toggleOpen}
        disabled={isStreaming}
        className={`w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-muted-foreground/80 hover:text-foreground transition-colors select-none ${
          isStreaming ? 'cursor-default' : 'cursor-pointer hover:bg-muted/20'
        }`}
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="h-4.5 w-4.5 text-primary animate-spin" />
          ) : (
            <Brain className="h-4.5 w-4.5 text-primary/60 shrink-0" />
          )}
          <span>{isStreaming ? 'Thinking...' : 'Thought Process'}</span>
          {encrypted && (
            <span className="flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-mono font-medium">
              <Lock className="h-2.5 w-2.5" />
              <span>Encrypted</span>
            </span>
          )}
        </div>
        {!isStreaming && (
          <div>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        )}
      </button>

      {/* Expanded Content */}
      {isOpen && (
        <div className="px-4 pb-3 pt-1 border-t border-border/40 text-xs font-mono text-muted-foreground/80 leading-relaxed whitespace-pre-wrap select-text break-words select-none max-h-72 overflow-y-auto scrollbar-thin">
          {content}
        </div>
      )}
    </div>
  );
}
