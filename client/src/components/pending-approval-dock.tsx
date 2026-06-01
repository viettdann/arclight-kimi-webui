import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router';
import type { Block } from 'shared/types';
import { Button } from '@/components/ui/button';
import { useChatStore } from '../lib/chat-store';
import { sendWS } from '../lib/ws-send';
import { readArgString } from './blocks/timeline/types';

type Resolution = 'approve' | 'approve_for_session' | 'reject';
type ApprovalBlock = Extract<Block, { kind: 'approval_request' }>;
type ToolCallBlock = Extract<Block, { kind: 'tool_call' }>;

function collectPending(blocks: Block[], out: ApprovalBlock[]): void {
  for (const b of blocks) {
    if (b.kind === 'approval_request' && !b.resolution) out.push(b);
    if (b.kind === 'subagent') collectPending(b.blocks, out);
  }
}

function findToolCall(blocks: Block[], toolCallId: string): ToolCallBlock | null {
  for (const b of blocks) {
    if (b.kind === 'tool_call' && b.toolCallId === toolCallId) return b;
    if (b.kind === 'subagent') {
      const r = findToolCall(b.blocks, toolCallId);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Sticky approval panel pinned just above ChatInput.
 *
 * Subscribes to chat-store; when one or more `approval_request` blocks for
 * the current session are unresolved, renders the oldest as a decision card.
 * Inline timeline rows show the request as an anchor (badge + command
 * preview) but no longer carry the action buttons — those live here so the
 * user can act without scrolling. All actions require an explicit click.
 */
export function PendingApprovalDock() {
  const { id: sessionId } = useParams<{ id: string }>();
  const blocks = useChatStore((s) => (sessionId ? s.sessions[sessionId]?.blocks : null));

  const { pending, current, toolCall } = useMemo(() => {
    if (!blocks) return { pending: [] as ApprovalBlock[], current: null, toolCall: null };
    const list: ApprovalBlock[] = [];
    collectPending(blocks, list);
    const first = list[0] ?? null;
    const call = first ? findToolCall(blocks, first.toolCallId) : null;
    return { pending: list, current: first, toolCall: call };
  }, [blocks]);

  const resolve = (response: Resolution) => {
    if (!sessionId || !current) return;
    useChatStore.getState().applyEvent(sessionId, 'approval_response', {
      requestId: current.requestId,
      response,
    });
    sendWS('approve_tool', { requestId: current.requestId, response }, sessionId);
  };

  // Report the dock's rendered height via a CSS variable so the Transcript
  // can extend its bottom padding past the float and not hide messages
  // behind us when the user scrolls to the end. The CSS consumer uses
  // `max(default, var)` — we publish height only, not height-plus-default.
  const cardRef = useRef<HTMLDivElement>(null);
  // Re-observe only when the active request changes; `current` is read for presence only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional requestId-only deps
  useEffect(() => {
    if (!current) return;
    const el = cardRef.current;
    if (!el) return;
    const root = document.documentElement;
    let alive = true;
    const ro = new ResizeObserver(() => {
      if (!alive) return;
      const h = el.getBoundingClientRect().height;
      root.style.setProperty('--approval-dock-h', `${Math.ceil(h)}px`);
    });
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
      root.style.removeProperty('--approval-dock-h');
    };
  }, [current?.requestId]);

  if (!current) return null;

  const isShell = toolCall?.name === 'Bash';
  const command = isShell && toolCall ? readArgString(toolCall, 'command') : '';
  const headline = (current.description ?? '').trim() || (current.action ?? '').trim();
  const queueExtra = pending.length - 1;

  return (
    <div
      className="absolute left-0 right-0 bottom-full z-20 px-3 md:px-4 pb-2 pointer-events-none select-none animate-in slide-in-from-bottom-2 fade-in duration-200"
      role="dialog"
      aria-label="Tool approval"
    >
      <div className="mx-auto max-w-3xl pointer-events-auto">
        <div
          ref={cardRef}
          className="rounded-lg border border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 overflow-hidden shadow-lg ring-1 ring-warning/10"
        >
          <div className="px-4 py-3 flex items-start gap-3 border-b border-border/40">
            <ShieldAlert className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground flex items-baseline gap-2 flex-wrap">
                <span>Approval required</span>
                {queueExtra > 0 && (
                  <span className="text-[11px] font-normal text-muted-foreground">
                    · {queueExtra} more queued
                  </span>
                )}
              </div>
              {headline && (
                <div className="text-xs text-muted-foreground mt-0.5 break-words">{headline}</div>
              )}
            </div>
          </div>

          {command && (
            <pre className="px-4 py-2 font-mono text-xs whitespace-pre-wrap break-words bg-muted/15 text-foreground/90 max-h-32 overflow-y-auto leading-relaxed">
              <span className="text-warning font-bold select-none">$ </span>
              {command}
            </pre>
          )}

          <div className="px-3 py-2 flex flex-col sm:flex-row gap-1 sm:justify-end border-t border-border/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => resolve('reject')}
              className="text-destructive hover:bg-destructive-wash hover:text-destructive cursor-pointer justify-center sm:order-1"
            >
              Deny
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => resolve('approve_for_session')}
              className="text-muted-foreground hover:text-foreground cursor-pointer justify-center sm:order-2"
            >
              Approve for session
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => resolve('approve')}
              className="cursor-pointer justify-center sm:order-3"
            >
              Approve
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
