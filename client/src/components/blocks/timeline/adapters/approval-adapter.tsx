import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { ApprovalRailBlock, RailRowShape } from '../types';

type Resolution = 'approve' | 'approve_for_session' | 'reject';

const RESOLUTION_LABEL: Record<Resolution, string> = {
  approve: 'Approved',
  approve_for_session: 'Approved for Session',
  reject: 'Rejected',
};

/** Compact "Awaiting approval" pill attached to the tool_call row heading. */
export function PendingApprovalBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-600">
      <ShieldAlert className="h-3 w-3" />
      <span>Awaiting approval</span>
    </span>
  );
}

/** Static inline badge on the tool_call row once approval has resolved. */
export function ApprovalBadge({ approval }: { approval: ApprovalRailBlock }) {
  const resolution = approval.resolution as Resolution | undefined;
  if (!resolution) return null;
  const isApproved = resolution === 'approve' || resolution === 'approve_for_session';
  const Icon = isApproved ? ShieldCheck : ShieldX;
  const label = RESOLUTION_LABEL[resolution];
  const colorCls = isApproved
    ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/5'
    : 'text-red-600 border-red-500/30 bg-red-500/5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${colorCls}`}
      title={`${label}: ${approval.action}`}
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </span>
  );
}

/**
 * Row shape for an orphan pending approval (one without a matching
 * tool_call yet — race during streaming). Normal-flow approvals fold into
 * their tool_call row via `PendingApprovalBadge`/`ApprovalBadge`. The
 * actual decision UI lives in `PendingApprovalDock` above the chat input;
 * this row only serves as a chronological anchor.
 */
export function approvalBlockToRow(b: ApprovalRailBlock): RailRowShape {
  return {
    icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />,
    verb: 'Awaiting approval',
    inline: <ApprovalActionLabel action={b.action} />,
    badge: <PendingApprovalBadge />,
    status: 'ok',
  };
}

function ApprovalActionLabel({ action }: { action: string }) {
  return <span className="font-mono text-muted-foreground/75">{action}</span>;
}
