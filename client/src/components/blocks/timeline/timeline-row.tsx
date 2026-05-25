import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RailRowShape, RailRowStatus } from './types';

interface TimelineRowProps {
  shape: RailRowShape;
}

/**
 * One row of the activity rail.
 *
 *   ●  Verb  inline-subject
 *   │
 *   ╰─ detail (indented)
 *
 * The rail line is drawn by the parent `ActivityTimeline` via a left border;
 * each row plants its icon on top of it using `-translate-x-1/2`.
 */
export function TimelineRow({ shape }: TimelineRowProps) {
  const iconWrap = statusWrap(shape.status, shape.icon);
  return (
    <li className="relative pl-7">
      {/* Icon centered on rail */}
      <span className="absolute left-0 top-0.5 -translate-x-1/2 bg-background rounded-full">
        {iconWrap}
      </span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-foreground/85">{shape.verb}</span>
        {shape.inline && <span className="text-xs">{shape.inline}</span>}
      </div>
      {shape.detail && <div className="mt-2 mb-1">{shape.detail}</div>}
    </li>
  );
}

function statusWrap(status: RailRowStatus, icon: ReactNode): ReactNode {
  switch (status) {
    case 'running':
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      );
    case 'error':
      return (
        <span
          className="inline-flex h-5 w-5 items-center justify-center text-red-500"
          title="Error"
        >
          <XCircle className="h-3.5 w-3.5" />
        </span>
      );
    case 'interrupted':
      return (
        <span
          className="inline-flex h-5 w-5 items-center justify-center text-amber-500"
          title="Interrupted"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
      );
    default:
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground/85">
          {icon}
        </span>
      );
  }
}

/** Static decoration: an inline "completed" check on the rail for terminal rows. */
export function CompletedDot() {
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
}
