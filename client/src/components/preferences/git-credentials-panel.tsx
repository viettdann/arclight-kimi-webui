import { useEffect, useState } from 'react';
import type { GitCredentialDTO, GitProvider } from 'shared/types';
import { Button } from '@/components/ui/button';
import { SecHead } from '@/components/ui/sec-head';
import { showToast } from '../../components/toast-provider';
import { useGitCredentialsStore } from '../../lib/git-credentials-store';
import { cn } from '../../lib/utils';
import { GitCredentialDialog } from './git-credential-dialog';

const PROVIDER_LABELS: Record<GitProvider, string> = {
  github: 'GitHub',
  azure_devops: 'Azure DevOps',
};

export function GitCredentialsPanel() {
  const credentials = useGitCredentialsStore((s) => s.credentials);
  const status = useGitCredentialsStore((s) => s.status);
  const error = useGitCredentialsStore((s) => s.error);
  const load = useGitCredentialsStore((s) => s.load);
  const remove = useGitCredentialsStore((s) => s.remove);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GitCredentialDTO | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    void load();
  }, []);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(cred: GitCredentialDTO) {
    setEditing(cred);
    setDialogOpen(true);
  }

  async function handleRemove(cred: GitCredentialDTO) {
    if (!window.confirm(`Remove credential "${cred.label}"?`)) return;
    const res = await remove(cred.id);
    showToast(
      res.ok
        ? { message: 'Credential removed', type: 'info' }
        : { message: res.error ?? 'Failed to remove credential', type: 'error' },
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <SecHead
        title="Git credentials"
        description="Personal access tokens used to clone private repositories over HTTPS."
        actions={
          <Button type="button" variant="default" size="sm" onClick={openAdd}>
            Add credential
          </Button>
        }
      />

      {credentials.length === 0 ? (
        <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
          No credentials yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {credentials.map((cred) => (
            <li
              key={cred.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted transition-colors"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{cred.label}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] border',
                      'bg-muted border-border text-muted-foreground',
                    )}
                  >
                    {PROVIDER_LABELS[cred.provider]}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground min-w-0">
                  <span className="font-mono">{cred.tokenMask}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <time
                  className="text-[11px] text-muted-foreground tabular-nums"
                  dateTime={cred.createdAt}
                  title={cred.createdAt}
                >
                  {formatDate(cred.createdAt)}
                </time>
                <Button type="button" variant="ghost" size="xs" onClick={() => openEdit(cred)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={() => handleRemove(cred)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GitCredentialDialog open={dialogOpen} onOpenChange={setDialogOpen} credential={editing} />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
