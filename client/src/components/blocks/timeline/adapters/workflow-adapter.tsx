import { Network } from 'lucide-react';
import { FallbackDetail } from '../fallback-detail';
import type { Adapter } from '../types';
import { readArgString, statusOf } from '../types';

/** Claude `Workflow` — orchestrates a multi-task run over subagents. */
export const WorkflowAdapter: Adapter = (ctx) => {
  const label =
    readArgString(ctx.call, 'name') ||
    readArgString(ctx.call, 'description') ||
    readArgString(ctx.call, 'workflow_name') ||
    readArgString(ctx.call, 'prompt');
  return {
    icon: <Network className="h-3.5 w-3.5" />,
    verb: 'Orchestrated',
    inline: label ? <span className="font-mono text-muted-foreground/75">{label}</span> : undefined,
    detail: <FallbackDetail output={ctx.result?.output} message={ctx.result?.message ?? null} />,
    status: statusOf(ctx),
  };
};
