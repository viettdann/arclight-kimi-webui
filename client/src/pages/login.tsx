import { Navigate } from 'react-router';
import { signIn } from '../lib/auth-client';
import { useAuthStore } from '../lib/auth-store';

// Login route. UI implementation is owned separately; this file owns the
// auth flow only — sign-in initiation and the already-authenticated bounce.
export function LoginPage() {
  const status = useAuthStore((s) => s.status);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const handleSignIn = (): void => {
    void signIn.social({ provider: 'microsoft', callbackURL: '/' });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="rounded-lg border border-slate-200 bg-white px-8 py-6 shadow-sm">
        <h1 className="text-xl font-semibold">Đăng nhập Kimi WebUI</h1>
        <button
          type="button"
          onClick={handleSignIn}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Tiếp tục với Microsoft
        </button>
      </div>
    </div>
  );
}
