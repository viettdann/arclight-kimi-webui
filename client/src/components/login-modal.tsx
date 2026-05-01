import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { signIn } from '../lib/auth-client';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  const handleSignIn = () => {
    setLoading(true);
    try {
      signIn.social({ provider: 'microsoft', callbackURL: '/' });
    } catch {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape and close button provide keyboard alternative
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ animation: 'modal-backdrop-in 150ms ease-out' }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl"
        style={{ animation: 'modal-panel-in 150ms ease-out' }}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-semibold">Welcome back</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to continue to More Than Coding
        </p>

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
      </div>
    </div>,
    document.body,
  );
}
