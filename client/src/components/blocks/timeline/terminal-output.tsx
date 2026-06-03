import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

interface TerminalOutputProps {
  command?: string;
  output?: string;
  isError?: boolean;
  /** Skip outer border/background so the caller can wrap with their own. */
  borderless?: boolean;
}

const MAX_LINES_COLLAPSED = 24;

/**
 * Compact terminal block: `$ command` then stdout/stderr.
 * Truncates to 24 lines with show-more button.
 */
export function TerminalOutput({ command, output, isError, borderless }: TerminalOutputProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    if (!command) return;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const outLines = (output ?? '').split('\n');
  const truncated = outLines.length > MAX_LINES_COLLAPSED && !expanded;
  const shown = truncated ? outLines.slice(0, MAX_LINES_COLLAPSED).join('\n') : (output ?? '');
  const hidden = outLines.length - MAX_LINES_COLLAPSED;

  return (
    <div
      className={
        borderless
          ? 'bg-muted/15'
          : 'rounded-md border border-border/70 bg-muted/15 overflow-hidden'
      }
    >
      {command && (
        <div className="px-3 py-2 border-b border-border/40 font-mono text-xs flex items-start gap-2 group">
          <span className="text-warning font-bold select-none shrink-0">$</span>
          <pre className="flex-1 whitespace-pre-wrap break-words text-foreground/90 leading-relaxed">
            {command}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Copy command"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      )}
      {output != null && output !== '' && (
        <div
          className={`px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words select-text ${
            isError ? 'text-destructive/90' : 'text-muted-foreground/95'
          }`}
        >
          {shown}
          {outLines.length > MAX_LINES_COLLAPSED && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="block mt-2 text-[10px] uppercase font-bold tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {expanded ? 'Show less' : `Show ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
