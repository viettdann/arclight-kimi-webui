import { ArrowRight, Check, GitCommitHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { GitStatusEntry } from 'shared/types/git-credentials';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '../../lib/auth-store';
import { useGitPanelStore } from '../../lib/git-panel-store';
import { classifyStatus, isStaged, TONE_BADGE } from './git-panel';

// Modal staging + commit. The full file list lives here rather than the sidebar
// so a long working tree never crowds the 320px column. Selection is explicit:
// staged files are pre-selected, but the user can toggle any file.
export function CommitDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = useGitPanelStore((s) => s.statusData?.entries ?? []);
  const logData = useGitPanelStore((s) => s.logData);
  const isBusy = useGitPanelStore((s) => s.isBusy);
  const refreshStatus = useGitPanelStore((s) => s.refreshStatus);
  const commitFiles = useGitPanelStore((s) => s.commitFiles);

  const user = useAuthStore((s) => s.user);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill message from last commit when amend is toggled on.
  useEffect(() => {
    if (amend && logData?.entries[0]?.message) {
      setMessage(logData.entries[0].message);
    }
  }, [amend, logData]);

  // Fetch a fresh status each time the modal opens, and reset the form so a
  // previous (committed) selection/message never lingers. Pre-select staged files.
  useEffect(() => {
    if (open) {
      const stagedPaths = entries.filter(isStaged).map((e) => e.path);
      setSelected(new Set(stagedPaths));
      setMessage('');
      setAmend(false);
      void refreshStatus();
    }
  }, [open, refreshStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconcile selection against the latest status: a path that vanished (e.g.
  // the file was committed elsewhere or the status refreshed) drops out so we
  // never submit a stale path the server would reject with `unknown_files`.
  useEffect(() => {
    const present = new Set(entries.map((e) => e.path));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (present.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [entries]);

  const allSelected = entries.length > 0 && selected.size === entries.length;

  const toggleOne = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.path)));
  };

  const identity = useMemo(() => {
    if (!user) return null;
    return `${user.name} <${user.email}>`;
  }, [user]);

  const hasHeadCommit = (logData?.entries.length ?? 0) > 0;
  const canCommit = selected.size > 0 && message.trim().length > 0 && !submitting && !isBusy;

  const handleCommit = async () => {
    if (!canCommit) return;
    setSubmitting(true);
    const ok = await commitFiles([...selected], message.trim(), amend);
    setSubmitting(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{amend ? 'Amend commit' : 'Commit changes'}</DialogTitle>
          <DialogDescription>
            Select files to commit and enter a message. Untracked and rename are handled automatically by the server.
          </DialogDescription>
        </DialogHeader>

        {/* Commit mode toggle */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="commit-mode"
              checked={!amend}
              onChange={() => setAmend(false)}
              className="accent-primary"
            />
            New commit
          </label>
          <label
            className={`flex items-center gap-2 text-sm cursor-pointer ${
              !hasHeadCommit ? 'opacity-50 pointer-events-none' : ''
            }`}
            title={!hasHeadCommit ? 'No commit to amend' : ''}
          >
            <input
              type="radio"
              name="commit-mode"
              checked={amend}
              onChange={() => setAmend(true)}
              disabled={!hasHeadCommit}
              className="accent-primary"
            />
            Amend last commit
          </label>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Working tree clean — nothing to commit.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selected.size > 0 ? `Selected · ${selected.size}/${entries.length}` : 'Files'}
              </span>
              <button
                type="button"
                onClick={toggleAll}
                className="rounded text-xs font-medium text-primary transition-colors hover:underline"
              >
                {allSelected ? 'Select none' : 'Select all'}
              </button>
            </div>
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {entries.map((entry, i) => (
                <CommitRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional
                  key={`${entry.path}-${i}`}
                  entry={entry}
                  checked={selected.has(entry.path)}
                  onToggle={() => toggleOne(entry.path)}
                />
              ))}
            </ul>
          </div>
        )}

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message"
          rows={3}
          disabled={entries.length === 0}
        />

        {amend && (
          <p className="text-xs text-muted-foreground">
            Message pre-filled from last commit. Edit as needed.
          </p>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          {identity ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              Commit as {identity}
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleCommit()} disabled={!canCommit}>
              <GitCommitHorizontal className="h-4 w-4" />
              {amend ? 'Amend commit' : 'Commit'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommitRow({
  entry,
  checked,
  onToggle,
}: {
  entry: GitStatusEntry;
  checked: boolean;
  onToggle: () => void;
}) {
  const { letter, tone } = classifyStatus(entry.statusCode);
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-accent">
        <Checkbox checked={checked} onChange={onToggle} />
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${TONE_BADGE[tone]}`}
        >
          {letter}
        </span>
        <span className="flex min-w-0 items-center gap-1 truncate" title={entry.path}>
          {entry.origPath && (
            <>
              <span className="truncate text-muted-foreground">{entry.origPath}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            </>
          )}
          <span className="truncate text-foreground">{entry.path}</span>
        </span>
        {checked && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
      </label>
    </li>
  );
}
