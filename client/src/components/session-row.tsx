import { useNavigate } from 'react-router';
import type { SessionListItem } from 'shared/types';
import { Button } from '@/components/ui/button';
import { sendWS } from '../lib/ws-send';

interface SessionRowProps {
  session: SessionListItem;
}

export function SessionRow({ session }: SessionRowProps) {
  const navigate = useNavigate();
  const title = session.title ?? 'Untitled session';
  const handleClick = () => {
    sendWS('resume_session', { sessionId: session.id });
    navigate(`/session/${session.id}`);
  };

  const statusColor =
    session.status === 'active'
      ? 'bg-green-500'
      : session.status === 'idle'
        ? 'bg-muted-foreground'
        : 'bg-muted-foreground/40';

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleClick}
      className="w-full justify-start gap-2 px-3 py-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} aria-hidden />
      <span className="truncate">{title}</span>
    </Button>
  );
}
