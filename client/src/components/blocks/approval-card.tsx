import { ShieldAlert, ShieldCheck, ShieldX, ChevronDown, ChevronRight } from 'lucide-react';
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
  const [isExpanded, setIsExpanded] = useState(false);

  const effective = resolution ?? optimistic;

  const handleResolve = (response: 'approve' | 'approve_for_session' | 'reject') => {
    if (!sessionId || effective) return;
    setOptimistic(response);
    sendWS('approve_tool', { requestId, response }, sessionId);
  };

  const isApproved = effective === 'approve' || effective === 'approve_for_session';
  const isRejected = effective === 'reject';

  // Khi đã xử lý duyệt hoặc từ chối, hiển thị dạng inline xám tối giản có thể thu gọn/mở rộng
  if (effective) {
    const summaryText = description.split('\n')[0]?.substring(0, 45) ?? '';
    const displayDescription = summaryText.length >= 45 ? `${summaryText}...` : summaryText;

    return (
      <div className="rounded-lg border border-border bg-muted/20 overflow-hidden animate-in fade-in duration-200 w-full">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 cursor-pointer select-none"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {isApproved ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <ShieldX className="h-3.5 w-3.5 text-red-500 shrink-0" />
            )}
            <span className="font-mono text-foreground/80 truncate">
              {effective === 'approve'
                ? 'Approved'
                : effective === 'approve_for_session'
                  ? 'Approved for Session'
                  : 'Rejected'}
              : {action}
            </span>
            <span className="text-[10px] text-muted-foreground/60 shrink-0 font-normal truncate hidden sm:inline">
              ({displayDescription})
            </span>
          </div>
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          )}
        </button>
        {isExpanded && (
          <div className="px-3 py-2 border-t border-border/50 bg-background/40 text-[11px] font-mono text-foreground/80 max-h-72 overflow-y-auto scrollbar-thin select-text">
            <pre className="whitespace-pre-wrap break-words leading-relaxed">{description}</pre>
          </div>
        )}
      </div>
    );
  }

  // Khi chưa xử lý: hiển thị Card màu hổ phách cảnh báo nổi bật
  return (
    <div
      className="rounded-xl border border-amber-500/25 bg-amber-500/5 shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200 w-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 select-none border-b border-border/20">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <ShieldAlert className="h-4.5 w-4.5 text-amber-500" />
          <span className="text-amber-500">Action Requires Approval</span>
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

        {/* Buttons */}
        <div className="pt-2 border-t border-border/20 flex flex-wrap gap-2 justify-end">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => handleResolve('reject')}
            className="cursor-pointer"
          >
            Reject
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500 cursor-pointer"
            onClick={() => handleResolve('approve_for_session')}
          >
            Approve for Session
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => handleResolve('approve')}
            className="cursor-pointer"
          >
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
