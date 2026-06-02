import { useEffect, useState } from 'react';
import { USER_PREFERENCES_MAX_BYTES } from 'shared/types';
import { Button } from '@/components/ui/button';
import { SecHead } from '@/components/ui/sec-head';
import { Textarea } from '@/components/ui/textarea';
import { getUserPreferences, putUserPreferences } from '../../api/me-preferences';
import { useRegisterDirty } from '../settings/use-settings-dirty';
import { showToast } from '../toast-provider';

type Status = 'idle' | 'loading' | 'ready' | 'error';

// UTF-8 byte length matches the server's cap (it measures bytes, not chars), so
// the counter never disagrees with the actual reject threshold. The encoder is
// module-level so the per-keystroke count reuses one instance.
const enc = new TextEncoder();
const byteLength = (s: string): number => enc.encode(s).length;

export function InstructionsPanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Load once on mount; the effect reads no props/state so its dep array is
  // empty (only the stable setters are used).
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getUserPreferences()
      .then((res) => {
        if (cancelled) return;
        setSaved(res.content);
        setDraft(res.content);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bytes = byteLength(draft);
  const overCap = bytes > USER_PREFERENCES_MAX_BYTES;
  const dirty = draft !== saved;
  useRegisterDirty('instructions', dirty);

  async function handleSave() {
    if (overCap || !dirty || saving) return;
    setSaving(true);
    try {
      const res = await putUserPreferences({ content: draft });
      setSaved(res.content);
      setDraft(res.content);
      showToast({ message: 'Global instructions saved', type: 'info' });
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : 'Failed to save',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {status === 'error' && loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <SecHead
        title="Global instructions"
        description="Personal instructions applied to every project you run."
        actions={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!dirty || overCap || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Always respond in Vietnamese. Prefer terse answers."
          rows={16}
          spellCheck={false}
          className="font-mono text-xs leading-[1.6] resize-y min-h-[18rem]"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Applies to all your projects. Not used for a project's own instructions.
          </span>
          <span
            className={
              overCap ? 'font-semibold text-destructive' : 'tabular-nums text-muted-foreground'
            }
          >
            {bytes.toLocaleString()} / {USER_PREFERENCES_MAX_BYTES.toLocaleString()} bytes
          </span>
        </div>
      </div>
    </div>
  );
}
