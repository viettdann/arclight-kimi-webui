import { ChevronDown, ChevronRight, CloudDownload, FolderTree, Plus } from 'lucide-react';
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
import { useProjectsStore } from '../lib/projects-store';
import { useSidebarViewStore } from '../lib/sidebar-view-store';
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

  const handleNewTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendWS('create_session', { workDir: project.workDir });
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
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => toggleExpanded(project.name)}
          className="flex-1 justify-start gap-1.5 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="truncate font-medium">{project.name}</span>
        </Button>
        {isActive && !isForeign && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleOpenFiles}
            aria-label={`File management for ${project.name}`}
            title="File Management"
            className="hover:bg-sidebar-accent text-emerald-500"
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
            aria-label={`New task in ${project.name}`}
            className="hover:bg-sidebar-accent"
          >
            <Plus />
          </Button>
        )}
      </div>
      {expanded && (
        <div className="ml-4 flex flex-col gap-0.5 py-0.5">
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
