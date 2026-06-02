import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SecHead } from '@/components/ui/sec-head';
import { Section } from '@/components/ui/section';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_PROJECT_DISCOVERY_BLACKLIST } from 'shared/types';
import {
  getProjectDiscoverySettings,
  putProjectDiscoverySettings,
} from '../../api/project-discovery';
import { showToast } from '../toast-provider';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function ProjectDiscoverySection() {
  const [status, setStatus] = useState<Status>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedEntries, setSavedEntries] = useState<string[]>([]);
  const [savedMode, setSavedMode] = useState<'append' | 'override'>('append');
  const [draftEntries, setDraftEntries] = useState('');
  const [draftMode, setDraftMode] = useState<'append' | 'override'>('append');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getProjectDiscoverySettings()
      .then((res) => {
        if (cancelled) return;
        const text = res.entries.join('\n');
        setSavedEntries(res.entries);
        setSavedMode(res.mode);
        setDraftEntries(text);
        setDraftMode(res.mode);
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

  const dirty =
    draftEntries !== savedEntries.join('\n') || draftMode !== savedMode;

  async function handleSave() {
    if (!dirty || saving) return;
    const entries = draftEntries
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      const res = await putProjectDiscoverySettings({
        entries,
        mode: draftMode,
      });
      setSavedEntries(res.entries);
      setSavedMode(res.mode);
      setDraftEntries(res.entries.join('\n'));
      setDraftMode(res.mode);
      showToast({ message: 'Project discovery settings saved', type: 'info' });
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
        title="Project discovery"
        description="Control which folders are excluded from the project sidebar."
        actions={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!dirty || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      <div className="space-y-4">
        <Section
          title="Blacklist entries"
          description="One entry per line. These patterns are excluded when scanning projects."
        >
          <Textarea
            value={draftEntries}
            onChange={(e) => setDraftEntries(e.target.value)}
            placeholder="e.g. node_modules&#10;.git&#10;dist"
            rows={10}
            spellCheck={false}
            className="font-mono text-xs leading-[1.6] resize-y min-h-[12rem]"
          />
        </Section>

        <Section
          title="Mode"
          description="Choose how your custom entries combine with the default blacklist."
        >
          <div className="flex items-center gap-3">
            <Switch
              checked={draftMode === 'override'}
              onCheckedChange={(checked) =>
                setDraftMode(checked ? 'override' : 'append')
              }
              id="mode-switch"
              aria-label="Toggle override mode"
            />
            <label
              htmlFor="mode-switch"
              className="cursor-pointer text-sm text-foreground"
            >
              {draftMode === 'append'
                ? 'Append to defaults'
                : 'Override defaults'}
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {draftMode === 'append'
              ? 'Your entries are added to the default blacklist below.'
              : 'Only your entries are used; the default blacklist is ignored.'}
          </p>
        </Section>

        <Section
          title="Default blacklist"
          description="These entries are always active unless you switch to Override mode."
        >
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
              {DEFAULT_PROJECT_DISCOVERY_BLACKLIST.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
        </Section>
      </div>
    </div>
  );
}
