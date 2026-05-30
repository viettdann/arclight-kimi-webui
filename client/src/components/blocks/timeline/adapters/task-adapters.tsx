import { Workflow } from 'lucide-react';
import { FallbackDetail } from '../fallback-detail';
import type { Adapter } from '../types';
import { readArgString, statusOf } from '../types';

/** Claude `Task` — `description`, `prompt`, `subagent_type`. Delegates to a subagent. */
export const TaskAdapter: Adapter = (ctx) => {
  const description = readArgString(ctx.call, 'description');
  const subagent = readArgString(ctx.call, 'subagent_type');
  const label = description || subagent;
  return {
    icon: <Workflow className="h-3.5 w-3.5" />,
    verb: 'Delegated',
    inline: label ? (
      <span className="font-mono text-muted-foreground/75">
        {label}
        {description && subagent && <span className="text-muted-foreground/55"> · {subagent}</span>}
      </span>
    ) : undefined,
    detail: <FallbackDetail output={ctx.result?.output} message={ctx.result?.message ?? null} />,
    status: statusOf(ctx),
  };
};
