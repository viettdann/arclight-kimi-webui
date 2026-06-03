import {
  ChevronRight,
  CloudDownload,
  Folder,
  FolderTree,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ProjectSummary, SessionListItem } from 'shared/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { useNewSessionStore } from '../lib/new-session-store';
import { useProjectsStore } from '../lib/projects-store';
import { useSessionsStore } from '../lib/sessions-store';
import { useSidebarViewStore } from '../lib/sidebar-view-store';
import { cn } from '../lib/utils';
import { sendWS } from '../lib/ws-send';
import { ConfirmDeleteProjectDialog } from './confirm-delete-project-dialog';
import { SessionRow } from './session-row';
import { showToast } from './toast-provider';

interface ProjectRowProps {
  project: ProjectSummary;
  sessions: SessionListItem[];
  isActive: boolean;
}

export function ProjectRow({ project, sessions, isActive }: ProjectRowProps) {
  const navigate = useNavigate();
  const { id: openSessionId } = useParams<{ id: string }>();
  const expanded = useProjectsStore((s) => s.expanded[project.name] ?? false);
  const toggleExpanded = useProjectsStore((s) => s.toggleExpanded);
  const removeProject = useProjectsStore((s) => s.remove);
  const fetchSessions = useSessionsStore((s) => s.fetch);
  const openFiles = useSidebarViewStore((s) => s.openFiles);
  const isForeign = project.origin === 'foreign';
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const creating = useNewSessionStore((s) => s.pending[project.name] ?? false);
  const requestNewSession = useNewSessionStore((s) => s.request);

  const handleNewTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    requestNewSession(project);
  };

  const handleRestoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const handleOpenFiles = (e: React.MouseEvent) => {
    e.stopPropagation();
    openFiles();
  };

  const confirmRestore = () => {
    sendWS('adopt_project', { projectName: project.name });
    setConfirmOpen(false);
  };

  const handleConfirmDelete = async () => {
    await removeProject(project.name);
    // The project's sessions are gone server-side; resync the list and bail
    // out of any open session that belonged to it.
    await fetchSessions();
    if (openSessionId && sessions.some((s) => s.id === openSessionId)) {
      void navigate('/');
    }
    showToast({ message: `Project '${project.name}' deleted`, type: 'info' });
  };

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'group/project-row relative flex items-center rounded-lg',
          isActive && 'bg-sidebar-accent',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={() => toggleExpanded(project.name)}
          className={cn(
            'w-full justify-start gap-1.5 px-2 pr-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
            isActive && 'bg-transparent',
          )}
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{project.name}</span>
        </Button>

        {/* Trailing actions: hidden on desktop until hover/focus, always shown on
            touch. Mirrors SessionRow so projects and sessions feel consistent. */}
        <div className="absolute right-1.5 flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/project-row:opacity-100 md:group-hover/project-row:opacity-100">
          {isActive && !isForeign && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleOpenFiles}
              aria-label={`File management for ${project.name}`}
              title="File Management"
              className="text-emerald-500 hover:bg-sidebar-accent"
            >
              <FolderTree />
            </Button>
          )}
          {isForeign ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleRestoreClick}
              aria-label={`Restore project ${project.name}`}
              title={`Restore '${project.name}' to this machine`}
              className="hover:bg-sidebar-accent"
            >
              <CloudDownload />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleNewTask}
              disabled={creating}
              aria-label={`New task in ${project.name}`}
              title={`New task in ${project.name}`}
              className="hover:bg-sidebar-accent"
            >
              <Plus />
            </Button>
          )}
          <DropdownMenu
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${project.name}`}
                className="hover:bg-sidebar-accent"
              >
                <MoreHorizontal />
              </Button>
            }
          >
            <DropdownItem destructive icon={<Trash2 />} onClick={() => setConfirmDeleteOpen(true)}>
              Delete project
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>
      {expanded && (
        <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pb-0.5 pl-1">
          {sessions.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">No sessions yet</p>
          ) : (
            sessions.map((s) => <SessionRow key={s.id} session={s} />)
          )}
        </div>
      )}
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore project</DialogTitle>
            <DialogDescription>
              Restore '{project.name}'? {sessions.length} session
              {sessions.length === 1 ? '' : 's'} will be moved to this machine.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmRestore}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteProjectDialog
        isOpen={confirmDeleteOpen}
        project={project}
        sessions={sessions}
        onConfirm={handleConfirmDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}

interface CloningProjectRowProps {
  name: string;
}

// Placeholder row for a project whose `git clone` is still running. No expand
// toggle or sessions — just a spinner and a cancel button that aborts the clone.
export function CloningProjectRow({ name }: CloningProjectRowProps) {
  const cancelClone = useProjectsStore((s) => s.cancelClone);
  const [canceling, setCanceling] = useState(false);

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCanceling(true);
    void cancelClone(name);
  };

  return (
    <div className="group/cloning-row relative flex items-center rounded-lg">
      <div className="flex w-full items-center gap-1.5 px-2 pr-9 text-sidebar-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-muted-foreground">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">cloning…</span>
      </div>
      <div className="absolute right-1.5 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleCancel}
          disabled={canceling}
          aria-label={`Cancel cloning ${name}`}
          title="Cancel clone"
          className="hover:bg-sidebar-accent"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
