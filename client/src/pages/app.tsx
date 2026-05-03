import { useEffect, useRef, useState } from 'react';
import { ChatInput } from '../components/chat-input';
import { LoginModal } from '../components/login-modal';
import { Sidebar } from '../components/sidebar';
import { showToast, ToastProvider } from '../components/toast-provider';
import { WelcomeScreen } from '../components/welcome-screen';
import { useAuthStore } from '../lib/auth-store';

export function AppShell() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const status = useAuthStore((s) => s.status);
  const lastClearReason = useAuthStore((s) => s.lastClearReason);
  const wasPreviouslyAuthenticated = useRef(false);

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

  return (
    <div className="flex min-h-screen bg-background">
      <ToastProvider />
      <Sidebar onLoginClick={() => setIsModalOpen(true)} />
      <main className="flex flex-1 flex-col pl-64">
        <div className="flex flex-1 flex-col justify-center">
          <WelcomeScreen />
        </div>
        <ChatInput />
      </main>
      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
