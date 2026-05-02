import type { SessionListItem } from 'shared/types';
import { sendWS } from '../lib/ws-send';

interface SessionRowProps {
  session: SessionListItem;
}

export function SessionRow({ session }: SessionRowProps) {
  const title = session.title ?? 'Untitled session';
  const handleClick = () => {
    sendWS('resume_session', { sessionId: session.id });
  };

  const statusColor =
    session.status === 'active'
      ? 'bg-green-500'
      : session.status === 'idle'
        ? 'bg-muted-foreground'
        : 'bg-muted-foreground/40';

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} aria-hidden />
      <span className="truncate">{title}</span>
    </button>
  );
}
