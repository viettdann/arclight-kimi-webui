import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { ProjectSummary, SessionListItem } from 'shared/types';
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
        <button
          type="button"
          onClick={() => toggleExpanded(project.name)}
          className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate font-medium">{project.name}</span>
        </button>
        <button
          type="button"
          onClick={handleNewTask}
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent transition-colors"
          aria-label={`New task in ${project.name}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
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
