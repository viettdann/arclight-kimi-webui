import { useEffect } from 'react';
import { useChatStore } from '../../lib/chat-store';
import { useRightSidebarStore } from '../../lib/right-sidebar-store';
import { sendWS } from '../../lib/ws-send';
import { ContextPanel } from './context-panel';
import { GitPanel } from './git-panel';
import { TodoPanel } from './todo-panel';

interface RightSidebarProps {
  sessionId: string | undefined;
}

// Stacked, always-open panels (Todo → Context → Git). No accordion/disclosure:
// every panel renders inline and the column scrolls when content runs long.
// Git renders nothing for non-git projects, so it never adds an empty block.
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger — close on every session switch
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
        <div className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
          <TodoPanel sessionId={sessionId} />
          <ContextPanel sessionId={sessionId} />
          <GitPanel sessionId={sessionId} />
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
