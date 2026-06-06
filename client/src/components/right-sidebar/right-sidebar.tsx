import { X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useActiveWorkflow, useChatStore } from '../../lib/chat-store';
import { useRightSidebarStore } from '../../lib/right-sidebar-store';
import { sendWS } from '../../lib/ws-send';
import { ContextPanel } from './context-panel';
import { GitPanel } from './git-panel';
import { TodoPanel } from './todo-panel';
import { WorkflowPanel } from './workflow-panel';

interface RightSidebarProps {
  sessionId: string | undefined;
  activeProjectName: string | null;
}

// Stacked panels. With an open session: Todo → Context → Git (Todo/Context are
// session-scoped). With only a selected project (no session): Git alone, so the
// user can act on git without opening a chat. No accordion/disclosure: every
// panel renders inline and the column scrolls when content runs long. Git
// renders nothing for non-git projects, so it never adds an empty block.
export function RightSidebar({ sessionId, activeProjectName }: RightSidebarProps) {
  const open = useRightSidebarStore((s) => s.open);
  const close = useRightSidebarStore((s) => s.close);
  // A turn-end signal from the store: bumped once per completed turn (including
  // the turn that wraps a /compact). Drives the re-fetch without re-parsing raw
  // WS frames on the streaming hot path.
  const contextEpoch = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.contextEpoch ?? 0) : 0,
  );
  // When a workflow run is active (or just finished within the turn), the
  // Workflow panel replaces the Todo panel — the hook already encodes that.
  const activeWorkflow = useActiveWorkflow(sessionId ?? null);

  // Close only when there's nothing left to scope the panel to — leaving for the
  // welcome screen with no project selected. Switching session ↔ project or
  // project ↔ project keeps the panel as-is (selecting a project explicitly
  // opens it via the store).
  useEffect(() => {
    if (sessionId == null && activeProjectName == null) close();
  }, [sessionId, activeProjectName, close]);

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
        {/* Mobile-only header: an explicit Close button so the drawer can be
            dismissed without hunting for the backdrop. Desktop is a static
            column with no overlay, so it needs no close affordance. */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3 md:hidden">
          <span className="text-sm font-semibold text-sidebar-foreground">Details</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close panel"
            className="hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
          {/* Todo + Context are session-scoped — only shown when a chat is open.
              In project-only mode the column is Git alone. */}
          {sessionId && (
            <>
              {activeWorkflow ? (
                <WorkflowPanel sessionId={sessionId} />
              ) : (
                <TodoPanel sessionId={sessionId} />
              )}
              <ContextPanel sessionId={sessionId} />
            </>
          )}
          <GitPanel projectName={activeProjectName} />
        </div>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close panel"
          // A light scrim, not an opaque paper fill: the real app shell stays
          // visible behind the drawer (just dimmed), and the tap still closes.
          className="fixed inset-0 z-30 bg-foreground/20 md:hidden animate-in fade-in duration-200"
          onClick={close}
        />
      )}
    </>
  );
}
