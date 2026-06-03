import { AlertOctagon, XCircle } from 'lucide-react';

interface ErrorBlockProps {
  code: string;
  message: string;
  createdAt: string;
}

export function ErrorBlock({ code, message, createdAt }: ErrorBlockProps) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive-wash p-4 shadow-sm backdrop-blur-sm flex gap-3 animate-in fade-in duration-200 w-full">
      <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
      <div className="space-y-1 select-text">
        <div className="flex items-center gap-1.5 text-xs font-bold text-destructive font-mono">
          <AlertOctagon className="h-3.5 w-3.5" />
          <span>SYSTEM_ERROR ({code})</span>
        </div>
        <p className="text-xs text-destructive font-semibold leading-relaxed font-sans">
          {message}
        </p>
        <span className="block text-[9px] text-muted-foreground/60 font-mono pt-1 select-none">
          {new Date(createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}
