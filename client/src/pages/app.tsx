import { Loader2, Menu, Plus } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ChatInput } from '../components/chat-input';
import { ComingSoon } from '../components/coming-soon';
import { LoginModal } from '../components/login-modal';
import { PendingApprovalDock } from '../components/pending-approval-dock';
import { Sidebar } from '../components/sidebar';
import { showToast, ToastProvider } from '../components/toast-provider';
import { Transcript } from '../components/transcript';
import { WelcomeScreen } from '../components/welcome-screen';
import { useAuthStore } from '../lib/auth-store';
import { persistWidth, useOpenFileStore } from '../lib/open-file-store';
import { useSessionsStore } from '../lib/sessions-store';

// CodeMirror + every language mode + react-markdown live behind this split
// chunk; it only loads once the user actually opens a file.
const FileEditorPanel = lazy(() =>
  import('../components/file-editor-panel').then((m) => ({ default: m.FileEditorPanel })),
);

// Resize clamps (px) for the desktop chat/editor split.
const MIN_CHAT_PX = 320;
const MIN_EDITOR_PX = 400;

export function AppShell() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const status = useAuthStore((s) => s.status);
  const allowed = useAuthStore((s) => s.allowed);
  const lastClearReason = useAuthStore((s) => s.lastClearReason);
  const wasPreviouslyAuthenticated = useRef(false);

  const sessions = useSessionsStore((s) => s.sessions);
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title;
  const activeProjectName = currentSession?.projectName ?? null;

  const openFile = useOpenFileStore((s) => s.openFile);
  const editorWidthPct = useOpenFileStore((s) => s.editorWidthPct);
  const closeFile = useOpenFileStore((s) => s.close);
  const setWidth = useOpenFileStore((s) => s.setWidth);
  // The flex row that holds the chat column + handle + editor. Measure this,
  // NOT <main> — <main> includes the sidebar padding (md:pl-[300px]), which
  // would skew the px→% conversion and make the panel jump on drag start.
  const splitRef = useRef<HTMLDivElement>(null);
  // Teardown for an in-flight drag, so a mid-drag unmount can't leak the
  // window pointer listeners or leave userSelect disabled.
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  // Auto-close the editor when there's no active project to scope it to
  // (navigated to welcome, or switched to a session without a project).
  useEffect(() => {
    if (activeProjectName == null) closeFile();
  }, [activeProjectName, closeFile]);

  // Drag handle: track pointer, convert to a clamped percentage of the split
  // row. setWidth is in-memory (called every move); the final width is
  // persisted to localStorage once, on pointer-up.
  const onHandleDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const split = splitRef.current;
      if (split == null) return;
      let lastPct = editorWidthPct;
      const onMove = (ev: PointerEvent) => {
        const rect = split.getBoundingClientRect();
        const fromRight = rect.right - ev.clientX; // editor width in px
        const maxEditor = rect.width - MIN_CHAT_PX;
        const editorPx = Math.max(MIN_EDITOR_PX, Math.min(fromRight, maxEditor));
        lastPct = (editorPx / rect.width) * 100;
        setWidth(lastPct);
      };
      const teardown = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
        dragCleanup.current = null;
      };
      const onUp = () => {
        teardown();
        persistWidth(lastPct);
      };
      dragCleanup.current = teardown;
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editorWidthPct, setWidth],
  );

  // Keyboard resize: arrows nudge the editor width by ~2% per press.
  const onHandleKey = useCallback(
    (e: React.KeyboardEvent) => {
      const delta = e.key === 'ArrowLeft' ? 2 : e.key === 'ArrowRight' ? -2 : 0;
      if (delta === 0) return;
      e.preventDefault();
      const split = splitRef.current;
      if (split == null) return;
      const rect = split.getBoundingClientRect();
      const currentPx = (editorWidthPct / 100) * rect.width;
      const maxEditor = rect.width - MIN_CHAT_PX;
      const editorPx = Math.max(
        MIN_EDITOR_PX,
        Math.min(currentPx + (delta / 100) * rect.width, maxEditor),
      );
      const pct = (editorPx / rect.width) * 100;
      setWidth(pct);
      persistWidth(pct);
    },
    [editorWidthPct, setWidth],
  );

  useEffect(() => {
    if (status === 'authenticated') {
      wasPreviouslyAuthenticated.current = true;
    } else if (status === 'unauthenticated' && wasPreviouslyAuthenticated.current) {
      const message =
        lastClearReason === 'manual' ? 'Signed out' : 'Session expired. Please sign in again.';
      const type = lastClearReason === 'manual' ? 'info' : 'error';
      showToast({ message, type });
      setIsModalOpen(true);
      wasPreviouslyAuthenticated.current = false;
    }
  }, [status, lastClearReason]);

  // Tự động đóng sidebar drawer trên di động khi chuyển phiên chat mới
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger — close on every session switch
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [sessionId]);

  // Authenticated but not on the allowlist → hold them at Coming Soon.
  if (status === 'authenticated' && allowed === false) {
    return <ComingSoon />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <ToastProvider />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLoginClick={() => setIsModalOpen(true)}
      />
      <main className="flex flex-1 flex-col pl-0 md:pl-[300px] h-screen overflow-hidden">
        {/* Mobile Top Header */}
        <header className="flex md:hidden items-center justify-between px-4 py-3 border-b border-border bg-sidebar shrink-0 h-14 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              className="hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              M
            </div>
            <span className="text-sm font-semibold truncate text-sidebar-foreground">
              {sessionId ? sessionTitle || 'Chat Session' : 'More Than Coding'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate('/')}
              aria-label="New task"
              title="New task"
              className="hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer"
            >
              <Plus className="h-4.5 w-4.5" />
            </Button>
          </div>
        </header>

        <div ref={splitRef} className="flex min-h-0 flex-1">
          {/* Chat column. Always `flex-1` so it elastically fills whatever the
              editor (the one %-anchored side) and the 1px handle leave behind —
              anchoring both sides to % would overflow by the handle width and
              jump on drag start. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {sessionId ? (
              <Transcript />
            ) : (
              <div className="flex flex-1 flex-col justify-start md:justify-center overflow-y-auto">
                <WelcomeScreen />
              </div>
            )}
            <div className="relative shrink-0">
              {sessionId && <PendingApprovalDock />}
              <ChatInput />
            </div>
          </div>

          {/* Editor panel. Desktop: right column with a drag handle. Mobile:
              fixed full-screen overlay covering the chat. Single instance so
              the buffer/dirty state isn't duplicated. */}
          {openFile != null && (
            <>
              {/* ARIA APG window-splitter: a focusable separator with a
                  valuenow is the correct role here, not <hr>. */}
              {/* biome-ignore lint/a11y/useSemanticElements: focusable resize splitter, not a thematic break */}
              <div
                onPointerDown={onHandleDown}
                onKeyDown={onHandleKey}
                className="hidden md:block w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 active:bg-primary/60 focus-visible:bg-primary/60 focus-visible:outline-none"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor"
                aria-valuenow={Math.round(editorWidthPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                tabIndex={0}
              />
              <div
                className="fixed inset-0 z-50 flex flex-col md:static md:z-auto md:min-w-0 md:shrink-0 md:grow-0 md:border-l md:border-border"
                style={{ flexBasis: `${editorWidthPct}%` }}
              >
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center bg-background">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <FileEditorPanel />
                </Suspense>
              </div>
            </>
          )}
        </div>
      </main>
      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
