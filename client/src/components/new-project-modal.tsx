import { type FormEvent, useEffect, useState } from 'react';
import { useProjectsStore } from '../lib/projects-store';
import { Modal } from './modal';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewProjectModal({ isOpen, onClose }: NewProjectModalProps) {
  const create = useProjectsStore((s) => s.create);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset on every open/close transition so a stale error from a previous
  // attempt never leaks into the next opening of the modal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpen is the trigger, not a read dependency
  useEffect(() => {
    setName('');
    setError(null);
    setSubmitting(false);
  }, [isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      setError('Name must be 1-60 characters');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await create(trimmed);
      onClose();
    } catch (err) {
      // ProjectError extends Error, so .message is safe; non-Error throws fall
      // back to a generic string.
      const message = err instanceof Error ? err.message : 'Failed to create project';
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="New project">
      <h2 className="text-lg font-semibold">New project</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a workspace folder for your tasks.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Project name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My project"
            maxLength={60}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            // biome-ignore lint/a11y/noAutofocus: modal entry input
            autoFocus
          />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
