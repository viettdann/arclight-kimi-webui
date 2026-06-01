import { AlertTriangle, Folder, GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectStatResponse, ProjectSummary, SessionListItem } from 'shared/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authFetch } from '../lib/auth-fetch';

interface ConfirmDeleteProjectDialogProps {
  isOpen: boolean;
  project: ProjectSummary;
  sessions: SessionListItem[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const MAX_TITLES = 8;

export function ConfirmDeleteProjectDialog({
  isOpen,
  project,
  sessions,
  onConfirm,
  onClose,
}: ConfirmDeleteProjectDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const [stat, setStat] = useState<ProjectStatResponse | null>(null);
  const [statStatus, setStatStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Deleting any session destroys real data → require an explicit checkbox.
  // A 0-session project (empty or foreign-with-no-rows) deletes on a plain click.
  const requireAck = sessions.length > 0;
  const canDelete = !submitting && (!requireAck || acked);

  // Reset transient state + lazily fetch the folder snapshot each time the
  // dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setSubmitting(false);
    setError(null);
    setAcked(false);
    setStat(null);
    setStatStatus('loading');

    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/projects/${encodeURIComponent(project.name)}/stat`);
        if (cancelled) return;
        if (!res.ok) {
          setStatStatus('error');
          return;
        }
        const body = (await res.json()) as ProjectStatResponse;
        if (cancelled) return;
        setStat(body);
        setStatStatus('ready');
      } catch {
        if (!cancelled) setStatStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, project.name]);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setSubmitting(false);
    }
  };

  const shownTitles = sessions.slice(0, MAX_TITLES);
  const overflow = sessions.length - shownTitles.length;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{project.name}</span> will be permanently
            deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="truncate font-mono text-xs text-muted-foreground" title={project.workDir}>
            {project.workDir}
          </p>

          {/* Folder / git snapshot */}
          {statStatus === 'loading' && (
            <p className="text-xs text-muted-foreground">Reading folder…</p>
          )}
          {statStatus === 'ready' && stat?.exists && (
            <div className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Folder className="size-3.5" />
                {stat.entryCount} item{stat.entryCount === 1 ? '' : 's'} in folder
              </div>
              {stat.git && (
                <>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <GitBranch className="size-3.5" />
                    git: {stat.git.branch ?? 'detached HEAD'}
                  </div>
                  {stat.git.dirtyCount > 0 && (
                    <div className="flex items-center gap-1.5 font-medium text-amber-500">
                      <AlertTriangle className="size-3.5" />
                      {stat.git.dirtyCount} uncommitted change
                      {stat.git.dirtyCount === 1 ? '' : 's'}
                    </div>
                  )}
                  {stat.git.remote && (
                    <div className="truncate text-muted-foreground" title={stat.git.remote}>
                      remote: {stat.git.remote}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {statStatus === 'ready' && !stat?.exists && (
            <p className="text-xs text-muted-foreground">
              Not on this machine — only its database sessions will be removed.
            </p>
          )}

          {/* Sessions */}
          {sessions.length > 0 ? (
            <div>
              <p className="text-foreground">
                {sessions.length} session{sessions.length === 1 ? '' : 's'} will be permanently
                deleted:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {shownTitles.map((s) => (
                  <li key={s.id} className="truncate">
                    {s.title ?? s.firstUserText ?? 'Untitled session'}
                  </li>
                ))}
                {overflow > 0 && <li className="text-muted-foreground/70">+{overflow} more</li>}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">No sessions in this project.</p>
          )}

          {stat?.exists && (
            <p className="text-xs text-muted-foreground">
              All files in the project folder will be permanently deleted. This cannot be undone.
            </p>
          )}

          {requireAck && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <Checkbox
                checked={acked}
                onChange={(e) => setAcked(e.currentTarget.checked)}
                disabled={submitting}
                className="mt-0.5"
              />
              <span>
                I understand {sessions.length} session{sessions.length === 1 ? '' : 's'} and all
                files will be permanently deleted.
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={!canDelete}>
            {submitting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
