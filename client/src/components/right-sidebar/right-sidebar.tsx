import { X } from 'lucide-react';
import { type ComponentType, useEffect } from 'react';
import { useChatStore } from '../../lib/chat-store';
import { useRightSidebarStore } from '../../lib/right-sidebar-store';
import { sendWS } from '../../lib/ws-send';
import { Button } from '../ui/button';
import { ContextPanel } from './context-panel';
import { TodoPanel } from './todo-panel';

interface PanelProps {
  sessionId: string | undefined;
}

// Config-driven panel list. Add a panel here to surface it without touching the
// container layout.
const PANELS: { id: string; Component: ComponentType<PanelProps> }[] = [
  { id: 'todo', Component: TodoPanel },
  { id: 'context', Component: ContextPanel },
];

interface RightSidebarProps {
  sessionId: string | undefined;
}

export function RightSidebar({ sessionId }: RightSidebarProps) {
  const open = useRightSidebarStore((s) => s.open);
  const close = useRightSidebarStore((s) => s.close);
  // A turn-end signal from the store: bumped once per completed turn (including
  // the turn that wraps a /compact). Drives the re-fetch without re-parsing raw
  // WS frames on the streaming hot path.
  const contextEpoch = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.contextEpoch ?? 0) : 0,
  );

  // Force the panel closed on every session switch — open state is scoped to the
  // chat you're looking at, not carried into the next one.
  useEffect(() => {
    close();
  }, [sessionId, close]);

  // While open, request fresh context usage on open, on session switch, and once
  // per completed turn (contextEpoch). The server doesn't push context_usage on
  // its own, and the snapshot's cached value can be stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: contextEpoch is the trigger, not a read dependency
  useEffect(() => {
    if (!open || !sessionId) return;
    sendWS('request_context_usage', {}, sessionId);
  }, [open, sessionId, contextEpoch]);

  return (
    <>
      <aside
        // When closed, `inert` removes the off-screen drawer (and its Close
        // button) from the tab order / a11y tree on mobile; desktop uses md:hidden.
        inert={!open}
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-dvh w-[320px] flex-col border-l border-border bg-sidebar transition-transform duration-300 ease-in-out md:static md:z-auto md:h-auto md:shrink-0 ${
          open ? 'translate-x-0 md:w-[320px]' : 'translate-x-full md:hidden'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <span className="text-sm font-semibold">Details</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
          {PANELS.map(({ id, Component }) => (
            <Component key={id} sessionId={sessionId} />
          ))}
        </div>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close panel"
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
          onClick={close}
        />
      )}
    </>
  );
}
