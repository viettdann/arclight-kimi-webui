import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

type TodoStatus = 'pending' | 'in_progress' | 'done';

interface TodoStatusIconProps {
  status: TodoStatus;
  /** Size/extra classes for the icon. Defaults to the inline-block size. */
  className?: string;
}

/** Status iconography shared by the inline todo block and the sidebar todo panel. */
export function TodoStatusIcon({ status, className = 'h-5 w-5' }: TodoStatusIconProps) {
  if (status === 'done') {
    return <CheckCircle2 className={`${className} text-emerald-500 fill-emerald-500/10`} />;
  }
  if (status === 'in_progress') {
    return <Loader2 className={`${className} text-amber-500 animate-spin`} />;
  }
  return <Circle className={`${className} text-muted-foreground/50`} />;
}
