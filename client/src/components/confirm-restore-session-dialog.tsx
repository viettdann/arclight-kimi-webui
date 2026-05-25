import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmRestoreSessionDialogProps {
  isOpen: boolean;
  title: string;
  foreignWorkDir: string;
  localWorkDir: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmRestoreSessionDialog({
  isOpen,
  title,
  foreignWorkDir,
  localWorkDir,
  onConfirm,
  onClose,
}: ConfirmRestoreSessionDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore session on this machine?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{title}</span> was last active under{' '}
            <code className="rounded bg-muted px-1">{foreignWorkDir}</code>. It will be materialised
            at <code className="rounded bg-muted px-1">{localWorkDir}</code>. An empty folder is
            created if missing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
