import { type FormEvent, useEffect, useState } from 'react';
import type { GitCredentialDTO, GitProvider } from 'shared/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useGitCredentialsStore } from '../../lib/git-credentials-store';

interface GitCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential?: GitCredentialDTO | null;
  onSaved?: (cred: GitCredentialDTO) => void;
}

export function GitCredentialDialog({
  open,
  onOpenChange,
  credential,
  onSaved,
}: GitCredentialDialogProps) {
  const createCredential = useGitCredentialsStore((s) => s.create);
  const updateCredential = useGitCredentialsStore((s) => s.update);

  const isEdit = credential != null;

  const [label, setLabel] = useState('Azure DevOps PAT');
  const [provider, setProvider] = useState<GitProvider>('azure_devops');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form whenever the dialog opens or the target credential changes.
  // Edit reflects the target credential; Add seeds Azure DevOps defaults.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open/credential are the triggers
  useEffect(() => {
    if (credential) {
      setLabel(credential.label);
      setProvider(credential.provider);
    } else {
      setLabel('Azure DevOps PAT');
      setProvider('azure_devops');
    }
    setToken('');
    setError(null);
    setSubmitting(false);
  }, [open, credential]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('Label is required');
      return;
    }
    if (!isEdit && token.trim() === '') {
      setError('Token is required');
      return;
    }
    setSubmitting(true);
    setError(null);

    if (isEdit && credential) {
      const res = await updateCredential(credential.id, {
        label: trimmedLabel,
        provider,
        token: token.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to update credential');
        setSubmitting(false);
        return;
      }
      const next = useGitCredentialsStore
        .getState()
        .credentials.find((c) => c.id === credential.id);
      if (next) onSaved?.(next);
      onOpenChange(false);
    } else {
      const res = await createCredential({
        label: trimmedLabel,
        provider,
        token: token.trim(),
      });
      if (!res.ok || !res.credential) {
        setError(res.error ?? 'Failed to create credential');
        setSubmitting(false);
        return;
      }
      onSaved?.(res.credential);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit credential' : 'Add credential'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-cred-label">Label</Label>
            <Input
              id="git-cred-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My GitHub token"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-cred-provider">Provider</Label>
            <Select
              id="git-cred-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as GitProvider)}
            >
              <option value="github">GitHub</option>
              <option value="azure_devops">Azure DevOps</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-cred-token">Token</Label>
            <Input
              id="git-cred-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep current' : 'Personal access token'}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
