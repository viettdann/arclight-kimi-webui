import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '../lib/auth-store';

// Route guard for admin-only pages. Mirror of RequireAuth, with an extra
// role check. Silent redirect (no toast) when role !== 'admin' — non-admins
// should not learn that admin routes exist.
export function RequireAdmin({ children }: { children?: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);

  if (status === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (status === 'unauthenticated' || role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children ? children : <Outlet />;
}
