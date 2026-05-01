import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'error';
}

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let innerTimer: ReturnType<typeof setTimeout>;
    const outerTimer = setTimeout(() => {
      setExiting(true);
      innerTimer = setTimeout(() => onDismiss(toast.id), 200);
    }, 3000);
    return () => {
      clearTimeout(outerTimer);
      clearTimeout(innerTimer);
    };
  }, [toast.id, onDismiss]);

  const dismissWithAnimation = () => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  const handleClose = dismissWithAnimation;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${
        toast.type === 'error'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-border bg-card text-card-foreground'
      }`}
      style={{
        animation: `${exiting ? 'toast-slide-out' : 'toast-slide-in'} 200ms ease-out`,
      }}
    >
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        type="button"
        onClick={handleClose}
        className="ml-auto rounded p-0.5 hover:bg-black/5"
        aria-label="Close toast"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
