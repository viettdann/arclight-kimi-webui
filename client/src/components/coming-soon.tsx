import { Clock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { signOut } from '../lib/auth-client';
import { useAuthStore } from '../lib/auth-store';

// Shown to an authenticated user who is not on the allowlist. Adding their
// email to the allowlist lets them in on the next reload — no restart.
export function ComingSoon() {
  const [signingOut, setSigningOut] = useState(false);
  const email = useAuthStore((s) => s.user?.email);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      useAuthStore.getState().clearSession('manual');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-wash text-primary">
          <Clock className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-foreground">Coming soon</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Your access to More Than Code is pending. We'll let you in as soon as your account is
          enabled — no action needed on your side.
        </p>
        {email && (
          <p className="mt-4 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            {email}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={handleSignOut}
          disabled={signingOut}
          className="mt-6 h-10 w-full"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </div>
  );
}
