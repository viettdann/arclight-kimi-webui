import { useEffect, useState } from 'react';
import {
  APPROVAL_MODES,
  type ApprovalMode,
} from 'shared/types';
import { SecHead } from '@/components/ui/sec-head';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/lib/auth-store';
import { getSiteDefaults, putSiteSettings } from '../../api/config';
import { cn } from '../../lib/utils';
import { APPROVAL_LABELS, DefaultsPanel } from './defaults-panel';

/**
 * Workspace section: per-user session defaults + site-wide defaults (admin).
 */
export function WorkspacePanel() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-8">
      <div>
        <SecHead
          title="My defaults"
          description="Applied to every new session · Saved automatically."
        />
        <div className="mt-4">
          <DefaultsPanel />
        </div>
      </div>
      {isAdmin && (
        <div>
          <SecHead
            title="Site defaults"
            description="Default values for all users when they haven't set their own."
          />
          <div className="mt-4">
            <SiteDefaultsPanel />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Site defaults (admin-only) ──────────────────────────────────────────────

const SITE_KEYS = {
  thinking: 'session_defaults.thinking',
  approvalMode: 'session_defaults.approval_mode',
} as const;

type SiteStatus = 'idle' | 'loading' | 'ready' | 'error';

function SiteDefaultsPanel() {
  const [status, setStatus] = useState<SiteStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const [thinking, setThinking] = useState(true);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask');
  const [hasThinking, setHasThinking] = useState(false);
  const [hasApprovalMode, setHasApprovalMode] = useState(false);

  // Load site defaults once on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getSiteDefaults()
      .then((res) => {
        if (cancelled) return;
        const t =
          typeof res[SITE_KEYS.thinking] === 'boolean'
            ? (res[SITE_KEYS.thinking] as boolean)
            : true;
        const a =
          typeof res[SITE_KEYS.approvalMode] === 'string'
            ? (res[SITE_KEYS.approvalMode] as ApprovalMode)
            : 'ask';
        setThinking(t);
        setApprovalMode(a);
        setHasThinking(res[SITE_KEYS.thinking] !== undefined);
        setHasApprovalMode(res[SITE_KEYS.approvalMode] !== undefined);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load site defaults');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveSiteSetting(key: string, value: unknown) {
    setError(null);
    try {
      await putSiteSettings([{ key, value }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  async function deleteSiteSetting(key: string) {
    setError(null);
    try {
      await putSiteSettings([{ key, value: null }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
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
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Thinking */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Thinking mode</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Allow extended reasoning before answering.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
                hasThinking
                  ? 'bg-warning-wash text-warning'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {hasThinking ? 'Site override' : 'Code default'}
            </span>
            {hasThinking && (
              <button
                type="button"
                onClick={() => {
                  setThinking(true);
                  setHasThinking(false);
                  void deleteSiteSetting(SITE_KEYS.thinking);
                }}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Reset to default
              </button>
            )}
          </div>
        </div>
        <Switch
          checked={thinking}
          onCheckedChange={(on) => {
            setThinking(on);
            setHasThinking(true);
            void saveSiteSetting(SITE_KEYS.thinking, on);
          }}
        />
      </div>

      {/* Approval mode */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Approval mode</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            How tool calls are confirmed before they run.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
                hasApprovalMode
                  ? 'bg-warning-wash text-warning'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {hasApprovalMode ? 'Site override' : 'Code default'}
            </span>
            {hasApprovalMode && (
              <button
                type="button"
                onClick={() => {
                  setApprovalMode('ask');
                  setHasApprovalMode(false);
                  void deleteSiteSetting(SITE_KEYS.approvalMode);
                }}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Reset to default
              </button>
            )}
          </div>
        </div>
        <Select
          id="site-default-approval"
          value={approvalMode}
          onChange={(e) => {
            const mode = e.target.value as ApprovalMode;
            setApprovalMode(mode);
            setHasApprovalMode(true);
            void saveSiteSetting(SITE_KEYS.approvalMode, mode);
          }}
          className="w-auto min-w-[16rem]"
        >
          {APPROVAL_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {APPROVAL_LABELS[mode]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
