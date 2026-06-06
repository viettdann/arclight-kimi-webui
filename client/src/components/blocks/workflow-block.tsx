import { ChevronDown, ChevronRight, Loader2, Network, Square } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { Block, TaskUsage } from 'shared/types';
import { fmtTokens } from '../../lib/utils';
import { sendWS } from '../../lib/ws-send';
import { ChildStatusIcon, STATUS_BADGE, STATUS_LABEL } from '../display-blocks/workflow-status';

type WorkflowBlock = Extract<Block, { kind: 'workflow' }>;

interface WorkflowBlockProps {
  block: WorkflowBlock;
}

// Humanize a millisecond duration: `12s`, `1m 23s`, `2h 5m`.
function fmtDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function UsageLine({ usage }: { usage: TaskUsage }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
      <span>{fmtTokens(usage.totalTokens)} tokens</span>
      <span className="text-muted-foreground/40">·</span>
      <span>{fmtDuration(usage.durationMs)}</span>
    </span>
  );
}

export function WorkflowBlock({ block }: WorkflowBlockProps) {
  const { id: sessionId } = useParams<{ id: string }>();
  const [summaryOpen, setSummaryOpen] = useState(false);

  const isRunning = block.status === 'running';
  const canStop = isRunning && !!block.runId;

  const handleStop = () => {
    if (!sessionId || !block.runId) return;
    sendWS('stop_task', { taskId: block.runId }, sessionId);
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-primary/2 shadow-sm backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-4.5 w-4.5 shrink-0 text-primary animate-spin" />
          ) : (
            <Network className="h-4.5 w-4.5 shrink-0 text-primary/70" />
          )}
          <span className="truncate text-xs font-semibold text-primary">
            {block.workflowName || 'Workflow'}
          </span>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold ${STATUS_BADGE[block.status]}`}
          >
            {STATUS_LABEL[block.status]}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {block.usage && <UsageLine usage={block.usage} />}
          {canStop && (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1 rounded border border-destructive/30 bg-destructive-wash px-1.5 py-0.5 text-[10px] font-semibold text-destructive transition-colors hover:bg-destructive/15"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {block.children.length > 0 && (
        <ul className="max-h-72 space-y-2 overflow-y-auto border-t border-primary/10 bg-background/30 px-4 py-3 scrollbar-thin">
          {block.children.map((child) => (
            <li key={child.taskId} className="flex items-start gap-2.5 text-sm">
              <div className="shrink-0 pt-0.5">
                <ChildStatusIcon status={child.status} />
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="min-w-0 break-words font-medium text-foreground">
                  {child.description}
                </span>
                {child.lastToolName && (
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    {child.lastToolName}
                  </span>
                )}
                {child.summary && (
                  <span className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {child.summary}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Run summary (folded) */}
      {!isRunning && block.summary && (
        <div className="border-t border-primary/10 px-4 py-2">
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-muted-foreground select-none cursor-pointer"
          >
            {summaryOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <span>Summary</span>
          </button>
          {summaryOpen && (
            <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground/80 select-text">
              {block.summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
