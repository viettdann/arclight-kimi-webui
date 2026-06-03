import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface FallbackDetailProps {
  args?: unknown;
  output?: unknown;
  message?: string | null;
}

function fmt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Used by the fallback adapter — collapsible args + output dump. */
export function FallbackDetail({ args, output, message }: FallbackDetailProps) {
  const [open, setOpen] = useState(false);
  const argsStr = fmt(args);
  const outStr = fmt(output);
  const hasAny = argsStr.length > 0 || outStr.length > 0;

  return (
    <div className="space-y-2">
      {message && <div className="text-xs text-muted-foreground/90">{message}</div>}
      {hasAny && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span>{open ? 'Hide details' : 'Show details'}</span>
        </button>
      )}
      {open && (
        <div className="space-y-2">
          {argsStr && (
            <div className="rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] text-muted-foreground/90 max-h-48 overflow-y-auto scrollbar-thin">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                Arguments
              </div>
              <pre className="whitespace-pre-wrap break-words">{argsStr}</pre>
            </div>
          )}
          {outStr && (
            <div className="rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] text-muted-foreground/90 max-h-48 overflow-y-auto scrollbar-thin">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                Output
              </div>
              <pre className="whitespace-pre-wrap break-words">{outStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
