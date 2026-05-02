import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  panelClassName?: string;
  showCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  ariaLabel,
  children,
  panelClassName,
  showCloseButton = true,
}: ModalProps): ReactNode | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus first focusable element in panel (or close button if visible).
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const firstFocusable = panel.querySelector<HTMLElement>(
        'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (firstFocusable ?? closeButtonRef.current)?.focus();
    });

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

  if (!isOpen) return null;

  const panelClasses =
    'relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl';

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; ESC + close button provide keyboard alternative
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ animation: 'modal-backdrop-in 150ms ease-out' }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        ref={panelRef}
        className={panelClassName ?? panelClasses}
        style={{ animation: 'modal-panel-in 150ms ease-out' }}
      >
        {showCloseButton && (
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
