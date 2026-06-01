import { Box, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ToolCallCardProps {
  name: string;
  args: unknown;
  argsStreaming?: string;
  isStreaming?: boolean;
}

export function ToolCallCard({ name, args, argsStreaming, isStreaming }: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Auto-expand on first stream tick, but never override an explicit user toggle.
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !autoExpandedRef.current) {
      autoExpandedRef.current = true;
      setIsOpen(true);
    }
  }, [isStreaming]);

  const toggleOpen = () => setIsOpen((v) => !v);

  const getArgsString = () => {
    if (isStreaming || argsStreaming) {
      return argsStreaming || '';
    }
    try {
      return typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    } catch {
      return '';
    }
  };

  const argsStr = getArgsString();

  return (
    <div className="rounded-xl border border-border bg-card-2 shadow-sm backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-foreground/80">
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          ) : (
            <Box className="h-4 w-4 text-primary/60 shrink-0" />
          )}
          <span>
            {isStreaming ? 'Calling' : 'Called'} Tool:{' '}
            <span className="font-mono bg-muted/60 border border-border/80 px-1.5 py-0.5 rounded text-primary">
              {name}
            </span>
          </span>
        </div>

        {argsStr && (
          <button
            type="button"
            onClick={toggleOpen}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold tracking-wider font-sans">
              {isOpen ? 'Hide Args' : 'Show Args'}
            </span>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Expanded Arguments */}
      {isOpen && argsStr && (
        <div className="px-4 pb-3 pt-2 border-t border-border/40 text-[11px] font-mono text-muted-foreground bg-muted/5 max-h-48 overflow-y-auto scrollbar-thin select-text">
          <pre className="whitespace-pre-wrap leading-relaxed">{argsStr}</pre>
        </div>
      )}
    </div>
  );
}
