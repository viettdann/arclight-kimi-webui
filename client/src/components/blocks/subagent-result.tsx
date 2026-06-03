import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { TextBlock } from './text-block';

interface SubagentResultProps {
  toolName: string;
  output: unknown;
  message: string | null;
  isError: boolean;
  synthetic?: 'interrupted';
}

// A subagent returns its answer as Anthropic content blocks, e.g.
// `[{ type: 'text', text: '<markdown>' }]`. Pull the text out so it can be
// rendered as markdown instead of stringified JSON. Returns null when there's
// no readable text (caller shows the raw value as a plain fallback).
function extractMarkdown(output: unknown): string | null {
  if (typeof output === 'string') {
    return output.trim() ? output : null;
  }
  if (Array.isArray(output)) {
    const text = output
      .filter(
        (b): b is { type: 'text'; text: string } =>
          !!b &&
          typeof b === 'object' &&
          (b as { type?: unknown }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('\n\n');
    return text.trim() ? text : null;
  }
  return null;
}

function formatRaw(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/**
 * A subagent's final return value, rendered as a fold — collapsed by default,
 * mirroring the Subagent Session header above it. The subagent runs off to the
 * side of the main flow, so its answer stays tucked away until the reader opens
 * it, then renders inline as markdown.
 */
export function SubagentResult({
  toolName,
  output,
  message,
  isError,
  synthetic,
}: SubagentResultProps) {
  const [open, setOpen] = useState(false);

  const markdown = extractMarkdown(output);
  const isInterrupted = synthetic === 'interrupted';

  const statusLabel = isError ? 'Error' : isInterrupted ? 'Interrupted' : 'Completed';
  const statusColor = isError
    ? 'text-destructive'
    : isInterrupted
      ? 'text-warning'
      : 'text-success';

  return (
    <div>
      {/* Header — fold/unfold, mirrors the Subagent Session affordance above */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-xs select-none hover:bg-primary/5 cursor-pointer text-left"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isError ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive fill-destructive-wash" />
          ) : isInterrupted ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning fill-warning-wash" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success fill-success-wash" />
          )}
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
            Subagent Result
          </span>
          <span className={`text-[11px] font-medium ${statusColor}`}>{statusLabel}</span>
          <span className="font-mono bg-muted/65 border border-border/80 px-1.5 py-0.5 rounded text-[10px] text-foreground/80 shrink-0">
            {toolName || 'tool'}
          </span>
        </div>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Body — only mounted when open */}
      {open && (
        <div className="px-4 pb-3 flex flex-col gap-2.5">
          {message && (
            <div
              className={`text-xs px-3.5 py-2.5 rounded-xl border ${
                isError
                  ? 'border-destructive/30 bg-destructive-wash text-destructive'
                  : 'border-border bg-muted/15 text-muted-foreground/90'
              }`}
            >
              {message}
            </div>
          )}

          {/* Capped height with its own scroll so a long result never forces the
              reader to scroll past all of it to move on. */}
          <div className="rounded-xl border border-border bg-card/60 px-3.5 py-2.5 max-h-[36rem] overflow-y-auto scrollbar-thin select-text">
            {markdown !== null ? (
              <TextBlock content={markdown} />
            ) : (
              <pre className="font-mono text-[11px] text-muted-foreground/90 whitespace-pre-wrap">
                {formatRaw(output)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
