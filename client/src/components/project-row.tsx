import { ChevronRight, CloudDownload, Folder, FolderTree, Plus } from 'lucide-react';
import { useState } from 'react';
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
import { useNewSessionStore } from '../lib/new-session-store';
import { useProjectsStore } from '../lib/projects-store';
import { useSidebarViewStore } from '../lib/sidebar-view-store';
import { cn } from '../lib/utils';
import { sendWS } from '../lib/ws-send';
import { SessionRow } from './session-row';

interface ProjectRowProps {
  project: ProjectSummary;
  sessions: SessionListItem[];
  isActive: boolean;
}

export function ProjectRow({ project, sessions, isActive }: ProjectRowProps) {
  const expanded = useProjectsStore((s) => s.expanded[project.name] ?? false);
  const toggleExpanded = useProjectsStore((s) => s.toggleExpanded);
  const openFiles = useSidebarViewStore((s) => s.openFiles);
  const isForeign = project.origin === 'foreign';
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    </div>
  );
}
