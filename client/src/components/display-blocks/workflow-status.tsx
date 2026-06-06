import { XCircle } from 'lucide-react';
import type { Block, WorkflowChild } from 'shared/types';
import { TodoStatusIcon } from './todo-status-icon';

type WorkflowBlock = Extract<Block, { kind: 'workflow' }>;

// Run status → badge color, drawn from the shared theme status tokens
// (success / warning / destructive / muted) used across the timeline + todo UI.
export const STATUS_BADGE: Record<WorkflowBlock['status'], string> = {
  running: 'bg-warning-wash text-warning border-warning/30',
  completed: 'bg-success-wash text-success border-success/30',
  failed: 'bg-destructive-wash text-destructive border-destructive/30',
  stopped: 'bg-muted text-muted-foreground border-border',
};

export const STATUS_LABEL: Record<WorkflowBlock['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

// Child status → the shared todo iconography, with a distinct red icon for
// failures (todo statuses don't model failure).
export function ChildStatusIcon({ status }: { status: WorkflowChild['status'] }) {
  if (status === 'failed') {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  const mapped = status === 'completed' ? 'done' : status === 'running' ? 'in_progress' : 'pending';
  return <TodoStatusIcon status={mapped} className="h-4 w-4" />;
}
