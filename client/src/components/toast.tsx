import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
          ? 'border-destructive/30 bg-destructive-wash text-destructive'
          : 'border-border bg-card text-card-foreground'
      }`}
      style={{
        animation: `${exiting ? 'toast-slide-out' : 'toast-slide-in'} 200ms ease-out`,
      }}
    >
      <span className="text-sm font-medium">{toast.message}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleClose}
        className="ml-auto"
        aria-label="Close toast"
      >
        <X />
      </Button>
    </div>
  );
}
