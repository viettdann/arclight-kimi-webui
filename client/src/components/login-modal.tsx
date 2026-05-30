import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { signIn } from '../lib/auth-client';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [loading, setLoading] = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    try {
      signIn.social({ provider: 'microsoft', callbackURL: '/' });
    } catch {
      setLoading(false);
    }
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
          <DialogTitle>Welcome back</DialogTitle>
          <DialogDescription>Sign in to continue to More Than Code</DialogDescription>
        </DialogHeader>

        <Button
          type="button"
          variant="outline"
          onClick={handleSignIn}
          disabled={loading}
          className="mt-2 h-10"
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <svg viewBox="0 0 21 21" role="img" aria-label="Microsoft logo">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
          )}
          Continue with Microsoft
        </Button>
      </DialogContent>
    </Dialog>
  );
}
