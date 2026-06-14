import { useActiveWorkflow } from '../../lib/chat-store';
import { ChildStatusIcon, STATUS_BADGE, STATUS_LABEL } from '../display-blocks/workflow-status';

interface WorkflowPanelProps {
  sessionId: string | undefined;
}

// Read-only mirror of the active workflow run for the current session. Only
// renders while a workflow is active; otherwise the sidebar shows the todo
// panel instead.
export function WorkflowPanel({ sessionId }: WorkflowPanelProps) {
  const workflow = useActiveWorkflow(sessionId ?? null);

  if (!workflow) return null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-base font-semibold text-foreground">
          {workflow.workflowName || 'Workflow'}
        </h4>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold ${STATUS_BADGE[workflow.status]}`}
        >
          {STATUS_LABEL[workflow.status]}
        </span>
      </div>
      <ul className="max-h-72 space-y-2 overflow-y-auto [scrollbar-gutter:stable]">
        {workflow.children.map((child) => (
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
