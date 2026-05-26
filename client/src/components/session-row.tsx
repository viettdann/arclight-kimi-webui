import { Trash2 } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { SessionListItem } from 'shared/types';
import { Button } from '@/components/ui/button';
import { useSessionsStore } from '../lib/sessions-store';
import { sendWS } from '../lib/ws-send';
import { ConfirmDeleteSessionDialog } from './confirm-delete-session-dialog';
import { ConfirmRestoreSessionDialog } from './confirm-restore-session-dialog';
import { showToast } from './toast-provider';

interface SessionRowProps {
  session: SessionListItem;
}

export function SessionRow({ session }: SessionRowProps) {
  const navigate = useNavigate();
  const { id: openSessionId } = useParams<{ id: string }>();
  const remove = useSessionsStore((s) => s.remove);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const title = session.title ?? 'Untitled session';
  const isForeign = session.origin === 'foreign';

  const attach = () => {
    sendWS('resume_session', { sessionId: session.id });
    navigate(`/session/${session.id}`);
  };

  const handleClick = () => {
    if (isForeign) {
      setConfirmRestoreOpen(true);
      return;
    }
    attach();
  };

  const handleConfirmRestore = () => {
    setConfirmRestoreOpen(false);
    attach();
  };

  const handleDeleteClick = (e: MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await remove(session.id);
      if (openSessionId === session.id) {
        void navigate('/');
      }
      showToast({ message: 'Session deleted', type: 'info' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network_error';
      showToast({ message: `Delete failed: ${msg}`, type: 'error' });
      throw err;
    }
  };

  const statusColor =
    session.status === 'active'
      ? 'bg-green-500'
      : session.status === 'idle'
        ? 'bg-muted-foreground'
        : 'bg-muted-foreground/40';

  const tooltip = isForeign
    ? `Foreign session — last seen at ${session.workDir}\nWill be restored into ${session.localWorkDir}`
    : title;

  return (
    <>
      <div className="group/session-row relative flex items-center">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClick}
          title={tooltip}
          className="w-full justify-start gap-2 px-3 py-1.5 pr-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} aria-hidden />
          <span className="truncate">{title}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleDeleteClick}
          aria-label={`Delete session ${title}`}
          className="absolute right-1.5 opacity-0 transition-opacity group-hover/session-row:opacity-100 focus-visible:opacity-100 hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>

      <ConfirmDeleteSessionDialog
        isOpen={confirmDeleteOpen}
        title={title}
        onConfirm={handleConfirmDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmRestoreSessionDialog
        isOpen={confirmRestoreOpen}
        title={title}
        foreignWorkDir={session.workDir}
        localWorkDir={session.localWorkDir}
        onConfirm={handleConfirmRestore}
        onClose={() => setConfirmRestoreOpen(false)}
      />
    </>
  );
}
