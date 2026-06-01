import { Loader2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { ChatInput } from '../components/chat-input';
import { PendingApprovalDock } from '../components/pending-approval-dock';
import { RightSidebar } from '../components/right-sidebar/right-sidebar';
import { Transcript } from '../components/transcript';
import { WelcomeScreen } from '../components/welcome-screen';
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

export function ChatView() {
  const { id: sessionId } = useParams<{ id: string }>();

  // Narrow selector — only re-render on projectName change for THIS session.
  const activeProjectName = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.projectName ?? null,
  );

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

  return (
    <div ref={splitRef} className="flex min-h-0 flex-1">
      {/* Chat column. Always `flex-1` so it elastically fills whatever the
          editor (the one %-anchored side) and the 1px handle leave behind —
          anchoring both sides to % would overflow by the handle width and
          jump on drag start. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {sessionId ? (
          <>
            {/* The right-panel toggle lives in the shared header (Shell), so the
                chat column is just the transcript + input here. */}
            <Transcript />
            <div className="relative shrink-0">
              <PendingApprovalDock />
              <ChatInput />
            </div>
          </>
        ) : (
          // Welcome: hero + cards + input live in ONE vertically-centered
          // stack. Keeping the input as a bottom-pinned sibling left a dead
          // gap in the middle; grouping it under the cards mirrors the
          // reference layout and reads as a single balanced unit.
          <div className="flex flex-1 flex-col justify-start md:justify-center overflow-y-auto">
            <WelcomeScreen />
            <ChatInput />
          </div>
        )}
      </div>

      {/* Editor panel. Desktop: right column with a drag handle. Mobile:
          fixed full-screen overlay covering the chat. Single instance so
          the buffer/dirty state isn't duplicated. */}
      {openFile != null && (
        <>
          {/* ARIA APG window-splitter: a focusable separator with a
              valuenow is the correct role here, not <hr>. */}
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

      {/* Right sidebar (Todo + Context). Desktop: ~320px flex column to the
          right of the editor; mobile: right overlay drawer. */}
      <RightSidebar sessionId={sessionId} />
    </div>
  );
}
