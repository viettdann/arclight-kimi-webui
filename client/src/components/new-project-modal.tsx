import { FolderPlus, GitBranch } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useGitCredentialsStore } from '../lib/git-credentials-store';
import { useProjectsStore } from '../lib/projects-store';
import { cn } from '../lib/utils';
import { GitCredentialDialog } from './preferences/git-credential-dialog';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mode = 'blank' | 'clone';

export function NewProjectModal({ isOpen, onClose }: NewProjectModalProps) {
  const create = useProjectsStore((s) => s.create);
  const credentials = useGitCredentialsStore((s) => s.credentials);
  const ensureCredsLoaded = useGitCredentialsStore((s) => s.ensureLoaded);

  const [mode, setMode] = useState<Mode>('blank');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [credDialogOpen, setCredDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset on every open/close transition so stale input or errors never leak
  // into the next opening of the modal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpen is the trigger, not a read dependency
  useEffect(() => {
    setMode('blank');
    setName('');
    setUrl('');
    setCredentialId('');
    setCredDialogOpen(false);
    setError(null);
    setSubmitting(false);
  }, [isOpen]);

  // Load credentials lazily once the user is configuring a clone.
  useEffect(() => {
    if (isOpen && mode === 'clone') ensureCredsLoaded();
  }, [isOpen, mode, ensureCredsLoaded]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'blank') {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 60) {
        setError('Name must be 1-60 characters');
        return;
      }
      setSubmitting(true);
      try {
        await create({ name: trimmed });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project');
        setSubmitting(false);
      }
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('Repository URL is required');
      return;
    }
    // Clone authenticates over HTTPS with a PAT, so a credential is required.
    if (!credentialId) {
      setError('Select or add a git credential');
      return;
    }
    setSubmitting(true);
    try {
      await create({
        name: name.trim() || undefined,
        source: { type: 'clone', url: trimmedUrl, credentialId },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Pick a starting point, then configure it.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div role="radiogroup" aria-label="Project source" className="grid grid-cols-2 gap-3">
            <ModeCard
              selected={mode === 'blank'}
              icon={<FolderPlus className="size-4" />}
              title="Blank"
              description="Empty workspace folder"
              onSelect={() => setMode('blank')}
            />
            <ModeCard
              selected={mode === 'clone'}
              icon={<GitBranch className="size-4" />}
              title="Clone"
              description="From a git repository"
              onSelect={() => setMode('clone')}
            />
          </div>

          <div className="flex flex-col gap-3">
            {mode === 'blank' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-project-name">Project name</Label>
                <Input
                  id="new-project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My project"
                  maxLength={60}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="clone-url">Repository URL</Label>
                  <Input
                    id="clone-url"
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo.git"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="clone-credential">Credential</Label>
                  <div className="flex gap-2">
                    <Select
                      id="clone-credential"
                      value={credentialId}
                      onChange={(e) => setCredentialId(e.target.value)}
                    >
                      <option value="" disabled>
                        Select a credential…
                      </option>
                      {credentials.map((cred) => (
                        <option key={cred.id} value={cred.id}>
                          {cred.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setCredDialogOpen(true)}
                    >
                      Add…
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="clone-name">
                    Project name <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="clone-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Auto from repo URL"
                    maxLength={60}
                  />
                </div>
              </>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? mode === 'clone'
                  ? 'Cloning…'
                  : 'Creating…'
                : mode === 'clone'
                  ? 'Clone'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <GitCredentialDialog
        open={credDialogOpen}
        onOpenChange={setCredDialogOpen}
        onSaved={(cred) => setCredentialId(cred.id)}
      />
    </Dialog>
  );
}

interface ModeCardProps {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
}

function ModeCard({ selected, icon, title, description, onSelect }: ModeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/40 hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md',
          selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
