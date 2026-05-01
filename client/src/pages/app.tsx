import { signOut } from '../lib/auth-client';
import { useAuthStore } from '../lib/auth-store';

// Protected app shell placeholder. Concrete UI is owned separately —
// this file only proves the auth wiring (manual logout) end-to-end.
export function AppShell() {
  const user = useAuthStore((s) => s.user);

  const handleLogout = async (): Promise<void> => {
    try {
      await signOut();
    } finally {
      useAuthStore.getState().clearSession('manual');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-900">
      <div className="rounded-lg border border-slate-200 bg-white px-8 py-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Kimi WebUI</h1>
        <p className="mt-2 text-sm text-slate-500">
          Đã đăng nhập: <span className="font-medium">{user?.email ?? '—'}</span>
        </p>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-4 inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
