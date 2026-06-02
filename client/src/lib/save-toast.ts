import { toast } from '../components/toast-provider';

export interface SaveToastOptions {
  /** Loading message while the save is in flight. */
  loading?: string;
  /** Message shown once the save resolves. */
  success?: string;
  /** Fallback message when the rejection isn't an Error. */
  error?: string;
  /** Called after the save settles with whether it failed — arm/clear dirty. */
  onSettled?: (failed: boolean) => void;
}

/**
 * Run a save through the standard toast lifecycle: a loading toast that
 * resolves to `success`, or an error toast carrying a Retry action that
 * re-runs the same `run`. `onSettled(failed)` lets callers arm/clear the dirty
 * flag that gates the Settings close-lock. Side effects a caller wants on every
 * attempt (including Retry) belong inside `run` so the retry closure repeats them.
 */
export function saveWithToast(run: () => Promise<unknown>, options: SaveToastOptions = {}): void {
  const { loading = 'Saving…', success = 'Saved', error = 'Failed to save', onSettled } = options;
  const id = toast.loading(loading);
  void run().then(
    () => {
      toast.success(success, { id });
      onSettled?.(false);
    },
    (e: unknown) => {
      onSettled?.(true);
      toast.error(e instanceof Error ? e.message : error, {
        id,
        action: { label: 'Retry', onClick: () => saveWithToast(run, options) },
      });
    },
  );
}
