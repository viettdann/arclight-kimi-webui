import { Toaster, toast } from 'sonner';

export { toast };

export function showToast({ message, type }: { message: string; type: 'info' | 'error' }) {
  if (type === 'error') {
    toast.error(message);
  } else {
    toast(message);
  }
}

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      theme="light"
      toastOptions={{
        classNames: {
          toast:
            'flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground shadow-lg',
          error: 'border-destructive/30 bg-destructive-wash text-destructive',
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
    />
  );
}
