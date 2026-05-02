import { Modal } from './modal';

interface SkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SkillsModal({ isOpen, onClose }: SkillsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Skills">
      <h2 className="text-lg font-semibold">Skills</h2>
      <p className="mt-2 text-sm text-muted-foreground">Skills are coming soon.</p>
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
