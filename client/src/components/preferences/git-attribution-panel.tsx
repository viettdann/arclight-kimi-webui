import { useEffect, useState } from 'react';
import { SecHead } from '@/components/ui/sec-head';
import { Switch } from '@/components/ui/switch';
import { getMySettings, putMySettings } from '../../api/config';
import { saveWithToast } from '../../lib/save-toast';
import { useRegisterDirty } from '../settings/use-settings-dirty';

// Must match the server's USER_SETTING_KEYS.gitIncludeCoAuthoredBy.
const KEY = 'git.include_co_authored_by';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Git attribution: opt in to keep Claude's `Co-Authored-By` trailer on
 * agent-driven commits. Off by default (attribution removed).
 */
export function GitAttributionPanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [include, setInclude] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useRegisterDirty('git-attribution', saveFailed);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getMySettings()
      .then((res) => {
        if (cancelled) return;
        setInclude(res[KEY] === true);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load settings');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange(next: boolean) {
    setInclude(next);
    saveWithToast(
      () => {
        setError(null);
        return putMySettings([{ key: KEY, value: next }]);
      },
      { onSettled: setSaveFailed },
    );
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
      <SecHead
        title="Git attribution"
        description="Controls how the agent attributes commits it makes on your behalf."
      />

      {status === 'error' && error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Include Co-Authored-By</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Add the <code className="font-mono text-xs">Co-Authored-By: Claude</code> trailer and
            "Generated with Claude Code" attribution to agent commits and PRs. Off by default.
          </p>
        </div>
        <div className="shrink-0">
          <Switch checked={include} onCheckedChange={handleChange} />
        </div>
      </div>
    </div>
  );
}
