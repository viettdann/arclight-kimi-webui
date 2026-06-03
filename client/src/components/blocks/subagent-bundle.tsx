import { AlertTriangle, Bot, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from 'shared/types';
import { BlockRegistry } from './block-registry';
import { SubagentResult } from './subagent-result';
import { ActivityTimeline } from './timeline/activity-timeline';
import { groupRailSegments } from './timeline/group-rail-segments';
import { parseArgs } from './timeline/types';

// Stable empty array so the `subagent?.blocks ?? EMPTY_BLOCKS` fallback keeps
// the same identity across renders and doesn't churn the segments memo.
const EMPTY_BLOCKS: Block[] = [];

interface SubagentBundleProps {
  toolCall: Extract<Block, { kind: 'tool_call' }>;
  subagent: Extract<Block, { kind: 'subagent' }> | null;
  toolResult: Extract<Block, { kind: 'tool_result' }> | null;
}

export function SubagentBundle({ toolCall, subagent, toolResult }: SubagentBundleProps) {
  const isStreaming = subagent?.isStreaming ?? !toolResult;
  // A synthetic interrupted result means the turn was killed before the subagent
  // returned (e.g. server restart) — report it as halted, not a quiet session.
  const isHalted = !isStreaming && toolResult?.synthetic === 'interrupted';
  const [isOpen, setIsOpen] = useState(true);
  const autoCollapsedRef = useRef(false);

  useEffect(() => {
    if (!isStreaming && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      setIsOpen(false);
    }
  }, [isStreaming]);

  const nestedBlocks = subagent?.blocks ?? EMPTY_BLOCKS;
  const activityCount = nestedBlocks.length;
  const nestedSegments = useMemo(() => groupRailSegments(nestedBlocks), [nestedBlocks]);

  // Args may arrive as a partial JSON string during streaming. parseArgs
  // concatenates head (args) + tail (argsStreaming) before JSON.parse so
  // description/prompt/subagent_type resolve even when chunked.
  const argsObj = parseArgs(toolCall);
  const argsDescription =
    argsObj && 'description' in argsObj ? String(argsObj.description ?? '') : '';
  const promptRaw = argsObj && 'prompt' in argsObj ? String(argsObj.prompt ?? '') : '';
  const promptPreview = promptRaw.slice(0, 240);
  const argsSubagentType =
    argsObj && 'subagent_type' in argsObj ? String(argsObj.subagent_type ?? '') : '';
  // Prefer the SDK-authoritative values carried on the subagent block (set from
  // `task_started`, available early in the live stream and on reload from the
  // subagents meta). Fall back to the Task tool_call args.
  const subagentType = subagent?.subagentType || argsSubagentType;
  const description = subagent?.description || argsDescription;

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/2 shadow-sm backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
      {/* Header — agent invocation */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex flex-col gap-1 px-4 py-2.5 text-xs select-none hover:bg-primary/5 cursor-pointer text-left"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {isStreaming ? (
              <Loader2 className="h-4.5 w-4.5 text-primary animate-spin shrink-0" />
            ) : isHalted ? (
              <AlertTriangle className="h-4.5 w-4.5 text-warning shrink-0" />
            ) : (
              <Bot className="h-4.5 w-4.5 text-primary/70 shrink-0" />
            )}
            <span className={`font-semibold ${isHalted ? 'text-warning' : 'text-primary'}`}>
              {isStreaming ? 'Subagent Running' : isHalted ? 'Subagent Halted' : 'Subagent Session'}
            </span>
            <span className="font-mono bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded text-[10px] text-primary shrink-0">
              {toolCall.name}
            </span>
            {subagentType && (
              <span className="font-mono bg-muted/40 border border-border/60 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground shrink-0">
                {subagentType}
              </span>
            )}
            {description && (
              <span className="text-foreground/80 truncate font-sans text-[11px] min-w-0">
                {description}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {activityCount} {activityCount === 1 ? 'activity' : 'activities'}
            </span>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </div>
        {promptPreview && (
          <div className="flex items-start gap-1.5 pl-6 text-[11px] text-muted-foreground font-sans leading-snug">
            <span className="font-mono text-muted-foreground/60 shrink-0">→</span>
            <span className="truncate">{promptPreview}</span>
          </div>
        )}
      </button>

      {/* Activity log — collapsible, lives off the main flow. The result is NOT
          in here: it sits below as its own section so reading the subagent's
          answer never requires expanding this and scrolling past every turn. */}
      {isOpen && (
        <div className="border-t border-primary/15 bg-card">
          {/* Nested events */}
          <div className="pl-4 pr-3 py-3 max-h-[36rem] overflow-y-auto scrollbar-thin">
            {nestedBlocks.length === 0 ? (
              <div className="text-[11px] font-medium text-muted-foreground/60 italic py-2 pl-2">
                Waiting for subagent actions...
              </div>
            ) : (
              <div className="border-l-2 border-primary/20 pl-4 space-y-4">
                {nestedSegments.map((seg) =>
                  seg.kind === 'rail' ? (
                    <ActivityTimeline
                      key={seg.id}
                      items={seg.items}
                      isTurnInProgress={isStreaming}
                    />
                  ) : (
                    <BlockRegistry key={seg.id} block={seg.item} />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Final tool_result (subagent's return) — its own fold, independent of the
          activity accordion above so it stays one click away after auto-collapse.
          Rich display blocks (rare for subagents) keep their dedicated renderers;
          the common text return folds into a markdown-rendered section. */}
      {toolResult &&
        (toolResult.displayBlocks && toolResult.displayBlocks.length > 0 ? (
          <div className="border-t border-primary/15 px-4 py-3 bg-muted/10">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">
              Subagent Result
            </div>
            <BlockRegistry block={toolResult} />
          </div>
        ) : (
          <div className="border-t border-primary/15 bg-muted/10">
            <SubagentResult
              toolName={toolResult.toolName}
              output={toolResult.output}
              message={toolResult.message}
              isError={toolResult.isError}
              synthetic={toolResult.synthetic}
            />
          </div>
        ))}
    </div>
  );
}
