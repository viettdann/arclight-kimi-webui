import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { sendWS } from '../../lib/ws-send';

interface ApprovalCardProps {
  requestId: string;
  action: string;
  description: string;
  resolution?: 'approve' | 'approve_for_session' | 'reject';
}

export function ApprovalCard({ requestId, action, description, resolution }: ApprovalCardProps) {
  const { id: sessionId } = useParams<{ id: string }>();
  const [optimistic, setOptimistic] = useState<
    'approve' | 'approve_for_session' | 'reject' | undefined
  >(undefined);

  const effective = resolution ?? optimistic;

  const handleResolve = (response: 'approve' | 'approve_for_session' | 'reject') => {
    if (!sessionId || effective) return;
    setOptimistic(response);
    sendWS('approve_tool', { requestId, response }, sessionId);
  };

  const isApproved = effective === 'approve' || effective === 'approve_for_session';
  const isRejected = effective === 'reject';

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200 ${
        isRejected
          ? 'border-red-500/20 bg-red-500/5'
          : isApproved
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-amber-500/25 bg-amber-500/5'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 select-none border-b border-border/20">
        <div className="flex items-center gap-2 text-xs font-semibold">
          {isRejected ? (
            <ShieldX className="h-4.5 w-4.5 text-red-500" />
          ) : isApproved ? (
            <ShieldCheck className="h-4.5 w-4.5 text-emerald-500" />
          ) : (
            <ShieldAlert className="h-4.5 w-4.5 text-amber-500" />
          )}
          <span
            className={
              isRejected ? 'text-red-500' : isApproved ? 'text-emerald-500' : 'text-amber-500'
            }
          >
            {isRejected
              ? 'Action Rejected'
              : isApproved
                ? 'Action Approved'
                : 'Action Requires Approval'}
          </span>
          <span className="ml-1 inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {action}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <pre className="text-xs font-mono bg-muted/60 border border-border px-3 py-2 rounded-md text-foreground whitespace-pre-wrap break-words leading-relaxed select-text">
          {description}
        </pre>

        {/* Buttons or Badge */}
        <div className="pt-2 border-t border-border/20">
          {!effective ? (
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => handleResolve('reject')}
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
                onClick={() => handleResolve('approve_for_session')}
              >
                Approve for Session
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => handleResolve('approve')}
              >
                Approve
              </Button>
            </div>
          ) : (
            <div className="flex justify-end text-xs font-semibold text-muted-foreground/80 font-sans">
              Resolution:{' '}
              <span
                className={`ml-1.5 font-bold ${isApproved ? 'text-emerald-500' : 'text-red-500'}`}
              >
                {effective === 'approve'
                  ? 'Approved'
                  : effective === 'approve_for_session'
                    ? 'Approved for Session'
                    : 'Rejected'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
