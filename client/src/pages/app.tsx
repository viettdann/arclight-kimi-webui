import { Menu, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ComingSoon } from '../components/coming-soon';
import { LoginModal } from '../components/login-modal';
import { Sidebar } from '../components/sidebar';
import { showToast, ToastProvider } from '../components/toast-provider';
import { useAuthStore } from '../lib/auth-store';
import { useSessionsStore } from '../lib/sessions-store';

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

  // Narrow selector — only re-render when the active session's title actually
  // changes (not on every unrelated sessions-store mutation).
  const sessionTitle = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId)?.title);

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
      <main className="flex flex-1 flex-col pl-0 md:pl-[300px] h-dvh overflow-hidden">
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
              {sessionId ? sessionTitle || 'Chat Session' : 'More Than Code'}
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

        <Outlet />
      </main>
      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
