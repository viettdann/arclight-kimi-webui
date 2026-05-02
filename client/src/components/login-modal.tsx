import { useState } from 'react';
import { signIn } from '../lib/auth-client';
import { Modal } from './modal';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [loading, setLoading] = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    try {
      signIn.social({ provider: 'microsoft', callbackURL: '/' });
    } catch {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Sign in">
      <h2 className="text-lg font-semibold">Welcome back</h2>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to continue to More Than Coding</p>

      <button
        type="button"
        onClick={handleSignIn}
        disabled={loading}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 21 21" role="img" aria-label="Microsoft logo">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
        )}
        Continue with Microsoft
      </button>
    </Modal>
  );
}
