import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmBypassDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmBypassDialog({ isOpen, onConfirm, onClose }: ConfirmBypassDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            Bypass permissions?
          </DialogTitle>
          <DialogDescription>
            Bypass permissions lets the agent run every tool — including file edits and shell
            commands — without asking for approval. You can switch back to a safer mode anytime.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Bypass permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
