import { ArrowRight, CloudDownload, Folder, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ProjectSummary } from 'shared/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useNewSessionStore } from '../lib/new-session-store';
import { useSessionsStore } from '../lib/sessions-store';

interface ProjectPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
}

// Collapse a leading /Users/<name> or /home/<name> to `~` for a compact,
// terminal-style path. Display-only; returns the input unchanged on no match.
function prettyPath(workDir: string): string {
  const m = workDir.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ''}` : workDir;
}

export function ProjectPickerModal({ isOpen, onClose, projects }: ProjectPickerModalProps) {
  const requestNewSession = useNewSessionStore((s) => s.request);
  const sessions = useSessionsStore((s) => s.sessions);

  const [query, setQuery] = useState('');

  // sessionCount[projectName] → number of sessions, for the per-row activity chip.
  const sessionCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sessions) c[s.projectName] = (c[s.projectName] ?? 0) + 1;
    return c;
  }, [sessions]);

  const locals = useMemo(() => projects.filter((p) => p.origin === 'local'), [projects]);
  const foreigns = useMemo(() => projects.filter((p) => p.origin === 'foreign'), [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return locals;
    return locals.filter(
      (p) => p.name.toLowerCase().includes(q) || p.workDir.toLowerCase().includes(q),
    );
  }, [locals, query]);

  // Start each opening with an empty filter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpen is the trigger, not a read dependency
  useEffect(() => {
    setQuery('');
  }, [isOpen]);

  const pick = (project: ProjectSummary) => {
    if (project.origin === 'foreign') return;
    requestNewSession(project);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Choose a project to start in.</DialogDescription>
        </DialogHeader>

        <div className="relative px-5 pb-3">
          <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>

        <div className="max-h-[22rem] overflow-y-auto px-3 pb-4">
          {filtered.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              No projects match “{query.trim()}”
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((p) => {
                const count = sessionCount[p.name] ?? 0;
                return (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Folder className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {p.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {prettyPath(p.workDir)}
                        </span>
                      </span>
                      {count > 0 && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                          {count}
                        </span>
                      )}
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {foreigns.length > 0 && (
            <div className="mt-2">
              <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Needs restore
              </p>
              <ul className="flex flex-col gap-0.5">
                {foreigns.map((p) => (
                  <li key={p.name}>
                    <div
                      title="Restore this project from the sidebar before starting a task here"
                      className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 opacity-55"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <CloudDownload className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {p.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          Restore to use on this machine
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
