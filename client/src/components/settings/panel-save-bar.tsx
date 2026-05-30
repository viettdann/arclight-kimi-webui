import { Button } from '@/components/ui/button';
import { useConfigStore } from '../../lib/config-store';
import { showToast } from '../toast-provider';

/**
 * Per-group Save/Discard footer. Operates only on `keys`, so each settings
 * panel saves its own cluster independently — no page-wide save. Renders
 * nothing until one of its keys has a staged edit.
 */
export function PanelSaveBar({ keys }: { keys: string[] }) {
  const drafts = useConfigStore((s) => s.drafts);
  const saving = useConfigStore((s) => s.saving);
  const save = useConfigStore((s) => s.save);
  const discard = useConfigStore((s) => s.discard);

  const dirty = keys.some((k) => k in drafts);
  if (!dirty) return null;

  async function handleSave() {
    const res = await save(keys);
    showToast(
      res.ok
        ? { message: 'Configuration saved', type: 'info' }
        : { message: res.error ?? 'Save failed', type: 'error' },
    );
  }

  async function handleDiscard() {
    await discard(keys);
    showToast({ message: 'Discarded local changes', type: 'info' });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={saving}
        onClick={() => void handleDiscard()}
      >
        Discard
      </Button>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
