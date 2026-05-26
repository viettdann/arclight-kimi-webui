import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Menu, Plus } from 'lucide-react';
import { ChatInput } from '../components/chat-input';
import { LoginModal } from '../components/login-modal';
import { Sidebar } from '../components/sidebar';
import { showToast, ToastProvider } from '../components/toast-provider';
import { Transcript } from '../components/transcript';
import { WelcomeScreen } from '../components/welcome-screen';
import { useAuthStore } from '../lib/auth-store';
import { useSessionsStore } from '../lib/sessions-store';
import { Button } from '@/components/ui/button';

export function AppShell() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const status = useAuthStore((s) => s.status);
  const lastClearReason = useAuthStore((s) => s.lastClearReason);
  const wasPreviouslyAuthenticated = useRef(false);

  const sessions = useSessionsStore((s) => s.sessions);
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title;

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
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [sessionId]);

  return (
    <div className="flex min-h-screen bg-background">
      <ToastProvider />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLoginClick={() => setIsModalOpen(true)}
      />
      <main className="flex flex-1 flex-col pl-0 md:pl-64 h-screen overflow-hidden">
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
              {sessionId ? (sessionTitle || 'Chat Session') : 'More Than Coding'}
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

        {sessionId ? (
          <Transcript />
        ) : (
          <div className="flex flex-1 flex-col justify-start md:justify-center overflow-y-auto">
            <WelcomeScreen />
          </div>
        )}
        <ChatInput />
      </main>
      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}

