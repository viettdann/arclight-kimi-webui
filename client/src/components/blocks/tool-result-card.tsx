import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { DisplayBlock as DisplayBlockType } from 'shared/types';
import { DisplayBlockRegistry } from '../display-blocks/display-block-registry';

interface ToolResultCardProps {
  toolCallId: string;
  toolName: string;
  output: unknown;
  message: string | null;
  displayBlocks: DisplayBlockType[];
  isError: boolean;
  synthetic?: 'interrupted';
}

export function ToolResultCard({
  toolName,
  output,
  message,
  displayBlocks,
  isError,
  synthetic,
}: ToolResultCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasDisplayBlocks = displayBlocks && displayBlocks.length > 0;
  const isInterrupted = synthetic === 'interrupted';

  // Format standard output if no display blocks
  const getFormattedOutput = () => {
    if (typeof output === 'string') return output;
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  };

  const outputText = getFormattedOutput();

  return (
    <div className="flex flex-col gap-2.5 w-full animate-in fade-in duration-200">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-1.5 font-medium select-none">
          {isError ? (
            <AlertCircle className="h-4.5 w-4.5 text-red-500 fill-red-500/10" />
          ) : isInterrupted ? (
            <AlertTriangle className="h-4.5 w-4.5 text-amber-500 fill-amber-500/10 animate-pulse" />
          ) : (
            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 fill-emerald-500/10" />
          )}
          <span
            className={
              isError
                ? 'text-red-500'
                : isInterrupted
                  ? 'text-amber-500 font-bold'
                  : 'text-emerald-500'
            }
          >
            {isError ? 'Error executing' : isInterrupted ? 'Interrupted' : 'Completed'}{' '}
            <span className="font-mono bg-muted/65 border border-border/80 px-1.5 py-0.5 rounded text-foreground/80 font-medium">
              {toolName || 'tool'}
            </span>
          </span>
        </div>

        {!hasDisplayBlocks && outputText && (
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold tracking-wider font-sans">
              {isOpen ? 'Hide Output' : 'View Output'}
            </span>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Message if present */}
      {message && (
        <div
          className={`text-xs px-3.5 py-2.5 rounded-xl border ${
            isError
              ? 'border-red-500/25 bg-red-500/5 text-red-600 dark:text-red-400'
              : 'border-border bg-muted/15 text-muted-foreground/90'
          }`}
        >
          {message}
        </div>
      )}

      {/* Display rich custom blocks */}
      {hasDisplayBlocks && (
        <div className="flex flex-col gap-3">
          {displayBlocks.map((block, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static tool-result blocks, never reordered
            <DisplayBlockRegistry key={idx} block={block} />
          ))}
        </div>
      )}

      {/* Fallback JSON console */}
      {!hasDisplayBlocks && isOpen && outputText && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden font-mono text-[11px] select-text">
          <div className="bg-muted/30 px-3 py-1.5 border-b border-border/80 text-[10px] text-muted-foreground font-sans font-medium uppercase tracking-wider">
            Raw Output Console
          </div>
          <div className="p-3 max-h-48 overflow-y-auto scrollbar-thin text-muted-foreground/90 leading-relaxed bg-muted/5">
            <pre className="whitespace-pre">{outputText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
