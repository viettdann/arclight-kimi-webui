import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
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

  const handleResolve = (response: 'approve' | 'approve_for_session' | 'reject') => {
    if (!sessionId) return;
    sendWS('approve_tool', { requestId, response }, sessionId);
  };

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200 ${
        resolution === 'reject'
          ? 'border-red-500/20 bg-red-500/5'
          : resolution
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-amber-500/25 bg-amber-500/5'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold select-none border-b border-border/20">
        {resolution === 'reject' ? (
          <ShieldX className="h-4.5 w-4.5 text-red-500" />
        ) : resolution ? (
          <ShieldCheck className="h-4.5 w-4.5 text-emerald-500" />
        ) : (
          <ShieldAlert className="h-4.5 w-4.5 text-amber-500" />
        )}
        <span
          className={
            resolution === 'reject'
              ? 'text-red-500'
              : resolution
                ? 'text-emerald-500'
                : 'text-amber-500'
          }
        >
          {resolution === 'reject'
            ? 'Action Rejected'
            : resolution
              ? 'Action Approved'
              : 'Action Requires Approval'}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Action
          </div>
          <code className="text-xs font-mono bg-muted/60 border border-border px-2 py-1 rounded block text-foreground break-all">
            {action}
          </code>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Description
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed font-sans">{description}</p>
        </div>

        {/* Buttons or Badge */}
        <div className="pt-2 border-t border-border/20">
          {!resolution ? (
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
                className={`ml-1.5 font-bold ${
                  resolution === 'approve' || resolution === 'approve_for_session'
                    ? 'text-emerald-500'
                    : 'text-red-500'
                }`}
              >
                {resolution === 'approve'
                  ? 'Approved'
                  : resolution === 'approve_for_session'
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
