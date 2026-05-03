import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { ProjectSummary, SessionListItem } from 'shared/types';
import { Button } from '@/components/ui/button';
import { useProjectsStore } from '../lib/projects-store';
import { sendWS } from '../lib/ws-send';
import { SessionRow } from './session-row';

interface ProjectRowProps {
  project: ProjectSummary;
  sessions: SessionListItem[];
}

export function ProjectRow({ project, sessions }: ProjectRowProps) {
  const expanded = useProjectsStore((s) => s.expanded[project.name] ?? false);
  const toggleExpanded = useProjectsStore((s) => s.toggleExpanded);

  const handleNewTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendWS('create_session', { workDir: project.workDir });
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
    </div>
  );
}
