import { Eye, ListTree, Square } from 'lucide-react';
import { FallbackDetail } from '../fallback-detail';
import type { Adapter } from '../types';
import { parseArgs, readArgString, statusOf } from '../types';

export const TaskListAdapter: Adapter = (ctx) => ({
  icon: <ListTree className="h-3.5 w-3.5" />,
  verb: 'Listed tasks',
  detail: <FallbackDetail output={ctx.result?.output} message={ctx.result?.message ?? null} />,
  status: statusOf(ctx),
});

export const TaskOutputAdapter: Adapter = (ctx) => {
  const id = readArgString(ctx.call, 'id') || readArgString(ctx.call, 'task_id');
  return {
    icon: <Eye className="h-3.5 w-3.5" />,
    verb: 'Read task output',
    inline: id ? <span className="font-mono text-muted-foreground/75">{id}</span> : undefined,
    detail: <FallbackDetail output={ctx.result?.output} message={ctx.result?.message ?? null} />,
    status: statusOf(ctx),
  };
};

export const TaskStopAdapter: Adapter = (ctx) => {
  const id = readArgString(ctx.call, 'id') || readArgString(ctx.call, 'task_id');
  return {
    icon: <Square className="h-3.5 w-3.5" />,
    verb: 'Stopped task',
    inline: id ? <span className="font-mono text-muted-foreground/75">{id}</span> : undefined,
    status: statusOf(ctx),
  };
};

/** ExitPlanMode etc. */
export const ExitPlanModeAdapter: Adapter = (ctx) => {
  const args = parseArgs(ctx.call);
  const plan = (args && typeof args.plan === 'string' && args.plan) || '';
  return {
    icon: <ListTree className="h-3.5 w-3.5" />,
    verb: 'Exited plan mode',
    detail: plan ? (
      <div className="rounded-md border border-border/60 bg-muted/15 p-3 text-xs text-muted-foreground/95 whitespace-pre-wrap break-words leading-relaxed">
        {plan}
      </div>
    ) : undefined,
    status: statusOf(ctx),
  };
};
