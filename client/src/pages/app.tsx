import { Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ComingSoon } from '../components/coming-soon';
import { LoginModal } from '../components/login-modal';
import { NewProjectModal } from '../components/new-project-modal';
import { ProjectPickerModal } from '../components/project-picker-modal';
import { Sidebar } from '../components/sidebar';
import { showToast, ToastProvider } from '../components/toast-provider';
import { useAuthStore } from '../lib/auth-store';
import { useProjectLaunchStore } from '../lib/project-launch-store';
import { useProjectsStore } from '../lib/projects-store';
import { useRightSidebarStore } from '../lib/right-sidebar-store';
import { useSessionsStore } from '../lib/sessions-store';

// Right-sidebar (Todo + Context) toggle glyph. Inlined rather than pulled from
// lucide so the header icon matches the status-panel mark used in the design.
function StatusPanelIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="none"
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M14 11.741V13H2v-1.259zm0-4.251v1.258H8.204V7.49zM14 3v1.258H2V3zM2.397 10.39 2 10.62V6l4 2.31z"
      />
    </svg>
  );
}

// `May 28, 17:46` — short month + day + 24h time, no year. Mirrors the compact
// timestamp style used elsewhere; falls back to the raw ISO on a bad input.
function formatSessionCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${date}, ${time}`;
  } catch {
    return iso;
  }
}

// Shell: top-level chrome (sidebar + login modal + mobile header + toast).
// Subtree pages render via <Outlet/>. Auth and allowlist gating live here so
// every subroute shares the same coming-soon / sign-in modal behavior.
export function Shell() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const status = useAuthStore((s) => s.status);
  const allowed = useAuthStore((s) => s.allowed);
  const lastClearReason = useAuthStore((s) => s.lastClearReason);
  const wasPreviouslyAuthenticated = useRef(false);
  const toggleRightSidebar = useRightSidebarStore((s) => s.toggle);

  // New-task project modals. They render once here (shared by the sidebar "New
  // task" and the Welcome composer) so two triggers can't mount two copies.
  const projects = useProjectsStore((s) => s.projects);
  const newProjectOpen = useProjectLaunchStore((s) => s.newProjectOpen);
  const pickerOpen = useProjectLaunchStore((s) => s.pickerOpen);
  const closeNewProject = useProjectLaunchStore((s) => s.closeNewProject);
  const closePicker = useProjectLaunchStore((s) => s.closePicker);

  // Narrow selectors — only re-render when THIS session's title/createdAt
  // changes (not on every unrelated sessions-store mutation).
  const sessionTitle = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId)?.title);
  const sessionCreatedAt = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.createdAt,
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

  // Auto-close sidebar drawer on mobile when switching to a new chat session
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger — close on every session switch
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [sessionId]);

  // Authenticated but not on the allowlist → hold them at Coming Soon.
  if (status === 'authenticated' && allowed === false) {
    return <ComingSoon />;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <ToastProvider />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLoginClick={() => setIsModalOpen(true)}
      />
      <main className="flex min-h-0 flex-1 flex-col pl-0 md:pl-[300px] h-full overflow-hidden">
        {/* Shared top header (desktop + mobile). Left: title + session
            create-time. Right: right-sidebar (Todo/Context) toggle. The
            hamburger only shows on mobile — desktop has the fixed left rail. */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar shrink-0 h-14 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              className="md:hidden hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {sessionId ? (
              // In a session: the brand mark links home; the title beside it is
              // the session's (title + create-time), plain text — not a link.
              <>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  aria-label="Go to home"
                  title="More Than Code — home"
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm transition-opacity hover:opacity-80"
                >
                  M
                </button>
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-sm font-semibold truncate text-sidebar-foreground">
                    {sessionTitle || 'Chat Session'}
                  </span>
                  {sessionCreatedAt && (
                    <span className="text-xs truncate text-muted-foreground">
                      {formatSessionCreatedAt(sessionCreatedAt)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              // Landing: brand mark + name are one home link, so clicking either
              // the logo or the "More Than Code" title navigates home.
              <button
                type="button"
                onClick={() => navigate('/')}
                aria-label="Go to home"
                title="More Than Code — home"
                className="flex min-w-0 items-center gap-2 cursor-pointer text-left transition-opacity hover:opacity-80"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
                  M
                </span>
                <span className="text-sm font-semibold truncate text-sidebar-foreground">
                  More Than Code
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            {sessionId && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleRightSidebar}
                aria-label="Toggle details panel"
                title="Toggle details panel"
                className="hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer"
              >
                <StatusPanelIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        <Outlet />
      </main>
      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <NewProjectModal isOpen={newProjectOpen} onClose={closeNewProject} />
      <ProjectPickerModal isOpen={pickerOpen} onClose={closePicker} projects={projects} />
    </div>
  );
}
