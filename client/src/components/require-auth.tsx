import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '../lib/auth-store';

// Route guard for the protected app shell. Reads the auth store's `status`
// and forks: loader for the bootstrap window, redirect to / when
// unauthenticated, render children when authenticated.
export function RequireAuth({ children }: { children?: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);

  if (status === 'unknown') {
    // Plain loader — the UI track owns the polished shell.
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-slate-500">Đang tải…</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/" replace />;
  }

  return children ? children : <Outlet />;
}
