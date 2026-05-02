import type { ProjectSummary } from 'shared/types';
import { sendWS } from '../lib/ws-send';
import { Modal } from './modal';

interface ProjectPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
}

export function ProjectPickerModal({ isOpen, onClose, projects }: ProjectPickerModalProps) {
  const handlePick = (project: ProjectSummary) => {
    sendWS('create_session', { workDir: project.workDir });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Pick a project">
      <h2 className="text-lg font-semibold">Pick a project</h2>
      <p className="mt-1 text-sm text-muted-foreground">Where should this new task live?</p>

      <ul className="mt-4 flex max-h-72 flex-col gap-1 overflow-y-auto">
        {projects.map((p) => (
          <li key={p.name}>
            <button
              type="button"
              onClick={() => handlePick(p)}
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
