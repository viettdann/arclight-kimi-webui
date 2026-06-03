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

interface ConfirmYoloDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmYoloDialog({ isOpen, onConfirm, onClose }: ConfirmYoloDialogProps) {
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
            <Zap className="h-4 w-4 text-amber-500" />
            Enable YOLO mode?
          </DialogTitle>
          <DialogDescription>
            YOLO mode lets the agent run every tool — including file edits and shell commands —
            without asking for approval. You can switch back to Normal anytime.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Enable YOLO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
