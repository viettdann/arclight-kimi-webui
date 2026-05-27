import type { ProjectSummary } from 'shared/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { sendWS } from '../lib/ws-send';

interface ProjectPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
}

export function ProjectPickerModal({ isOpen, onClose, projects }: ProjectPickerModalProps) {
  const handlePick = (project: ProjectSummary) => {
    if (project.origin === 'foreign') return;
    sendWS('create_session', { workDir: project.workDir });
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a project</DialogTitle>
          <DialogDescription>Where should this new task live?</DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {projects.map((p) => {
            const isForeign = p.origin === 'foreign';
            return (
              <li key={p.name}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handlePick(p)}
                  aria-disabled={isForeign}
                  title={isForeign ? 'Adopt a session inside this project first' : undefined}
                  className={
                    isForeign
                      ? 'w-full cursor-not-allowed justify-start gap-2 opacity-50'
                      : 'w-full justify-start gap-2'
                  }
                >
                  <span className="truncate">{p.name}</span>
                </Button>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
